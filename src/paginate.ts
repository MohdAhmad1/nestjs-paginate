import { Logger, ServiceUnavailableException } from '@nestjs/common'
import {
    Brackets,
    FindOptionsRelations,
    FindOptionsUtils,
    ObjectLiteral,
    Repository,
    SelectQueryBuilder,
} from 'typeorm'
import { OrmUtils } from 'typeorm/util/OrmUtils'
import { PaginateQuery } from './decorator'
import { addFilter } from './filter'
import {
    checkIsEmbedded,
    checkIsRelation,
    Column,
    extractVirtualProperty,
    fixColumnAlias,
    generateWhereStatement,
    getPropertiesByColumnName,
    includesAllPrimaryKeyColumns,
    isEntityKey,
    isRepository,
    Order,
    positiveNumberOrDefault,
    RelationColumn,
    SortBy,
} from './helper'
import { PaginateConfig, Paginated, PaginationLimit, PaginationType } from './types'
import { WherePredicateOperator } from 'typeorm/query-builder/WhereClause'

const logger: Logger = new Logger('nestjs-paginate')

export async function paginate<T extends ObjectLiteral>(
    query: PaginateQuery,
    repo: Repository<T> | SelectQueryBuilder<T>,
    config: PaginateConfig<T>
): Promise<Paginated<T>> {
    const queryBuilder = new NestJsPaginate(repo, query, config)

    queryBuilder.applyColumnsSelection().applyFilters().applyPagination().applySorting().applySearch()

    return queryBuilder.getPaginatedResponse()
}

export class NestJsPaginate<T extends ObjectLiteral> {
    private readonly config: PaginateConfig<T>
    private readonly query: PaginateQuery
    private readonly _queryBuilder: SelectQueryBuilder<T>

    constructor(repo: Repository<T> | SelectQueryBuilder<T>, query: PaginateQuery, config: PaginateConfig<T>) {
        const queryBuilder = this.initialize(repo, config)

        this.config = config
        this.query = query
        this._queryBuilder = queryBuilder
    }

    public get queryBuilder() {
        return this._queryBuilder
    }

    private initialize(repo: Repository<T> | SelectQueryBuilder<T>, config: PaginateConfig<T>) {
        const queryBuilder = isRepository(repo) ? repo.createQueryBuilder('__root') : repo

        if (isRepository(repo) && !config.relations && config.loadEagerRelations === true) {
            if (!config.relations) {
                FindOptionsUtils.joinEagerRelations(queryBuilder, queryBuilder.alias, repo.metadata)
            }
        }

        if (config.relations) {
            const relations = Array.isArray(config.relations)
                ? OrmUtils.propertyPathsToTruthyObject(config.relations)
                : config.relations

            function createQueryBuilderRelations(
                prefix: string,
                relations: FindOptionsRelations<T> | RelationColumn<T>[],
                alias?: string
            ) {
                Object.keys(relations).forEach((relationName) => {
                    const relationSchema = relations[relationName]!

                    queryBuilder.leftJoinAndSelect(
                        `${alias ?? prefix}.${relationName}`,
                        `${alias ?? prefix}_${relationName}_rel`
                    )

                    if (typeof relationSchema === 'object') {
                        createQueryBuilderRelations(
                            relationName,
                            relationSchema,
                            `${alias ?? prefix}_${relationName}_rel`
                        )
                    }
                })
            }

            createQueryBuilderRelations(queryBuilder.alias, relations)
        }

        if (config.withDeleted) {
            queryBuilder.withDeleted()
        }

        if (config.where && isRepository(repo)) {
            const baseWhereStr = generateWhereStatement(queryBuilder, config.where)
            queryBuilder.andWhere(`(${baseWhereStr})`)
        }

        return queryBuilder
    }

    applyColumnsSelection() {
        let selectParams =
            this.config.select && this.query.select && !this.config.ignoreSelectInQueryParam
                ? this.config.select.filter((column) => this.query.select.includes(column))
                : this.config.select

        if (!includesAllPrimaryKeyColumns(this.queryBuilder, this.query.select)) {
            selectParams = this.config.select
        }

        const cols: string[] = selectParams?.reduce((cols, currentCol) => {
            const columnProperties = getPropertiesByColumnName(currentCol)
            const isRelation = checkIsRelation(this.queryBuilder, columnProperties.propertyPath)
            cols.push(fixColumnAlias(columnProperties, this.queryBuilder.alias, isRelation))
            return cols
        }, [])

        this.queryBuilder.select(cols)

        return this
    }

    applyFilters() {
        if (this.query.filter) {
            addFilter(this.queryBuilder, this.query, this.config.filterableColumns)
        }

        return this
    }

    applySorting() {
        const dbType = this.queryBuilder.connection.options.type
        const isMariaDbOrMySql = (dbType: string) => dbType === 'mariadb' || dbType === 'mysql'
        const isMMDb = isMariaDbOrMySql(dbType)

        const sortBy = [] as SortBy<T>

        let nullSort: string | undefined

        if (this.config.nullSort) {
            if (isMMDb) {
                nullSort = this.config.nullSort === 'last' ? 'IS NULL' : 'IS NOT NULL'
            } else {
                nullSort = this.config.nullSort === 'last' ? 'NULLS LAST' : 'NULLS FIRST'
            }
        }

        if (this.config.sortableColumns.length < 1) {
            const message = "Missing required 'sortableColumns' config."
            logger.debug(message)
            throw new ServiceUnavailableException(message)
        }

        // Add provided sort by columns
        this.query.sortBy?.forEach((order) => {
            const isValidColumn = isEntityKey(this.config.sortableColumns, order[0])

            const isValidSortBy = ['ASC', 'DESC'].includes(order[1].toUpperCase())

            if (!isValidColumn && isValidSortBy) return

            sortBy.push(order as Order<T>)
        })

        if (!sortBy.length) {
            const defaultSortBy = this.config.defaultSortBy || [[this.config.sortableColumns[0], 'ASC']]

            sortBy.push(defaultSortBy[0])
        }

        for (const order of sortBy) {
            const columnProperties = getPropertiesByColumnName(order[0])
            const { isVirtualProperty } = extractVirtualProperty(this.queryBuilder, columnProperties)
            const isRelation = checkIsRelation(this.queryBuilder, columnProperties.propertyPath)
            const isEmbedded = checkIsEmbedded(this.queryBuilder, columnProperties.propertyPath)

            let alias = fixColumnAlias(
                columnProperties,
                this.queryBuilder.alias,
                isRelation,
                isVirtualProperty,
                isEmbedded
            )

            if (isMMDb) {
                if (isVirtualProperty) {
                    alias = `\`${alias}\``
                }

                if (nullSort) {
                    this.queryBuilder.addOrderBy(`${alias} ${nullSort}`)
                }

                this.queryBuilder.addOrderBy(alias, order[1])

                continue
            }

            if (isVirtualProperty) {
                alias = `"${alias}"`
            }

            this.queryBuilder.addOrderBy(alias, order[1], nullSort as 'NULLS FIRST' | 'NULLS LAST' | undefined)
        }

        return this
    }

    private get isPaginated() {
        const maxLimit = this.config.maxLimit || PaginationLimit.DEFAULT_MAX_LIMIT

        if (this.query.limit === PaginationLimit.COUNTER_ONLY) return false

        if (this.query.limit === PaginationLimit.NO_PAGINATION && maxLimit === PaginationLimit.NO_PAGINATION)
            return false

        return true
    }

    private get paginationLimit() {
        if (this.query.limit === PaginationLimit.COUNTER_ONLY) return PaginationLimit.COUNTER_ONLY

        const defaultLimit = this.config.defaultLimit || PaginationLimit.DEFAULT_LIMIT
        const maxLimit = this.config.maxLimit || PaginationLimit.DEFAULT_MAX_LIMIT

        if (!this.isPaginated) return defaultLimit

        if (maxLimit === PaginationLimit.NO_PAGINATION) return this.query.limit ?? defaultLimit

        if (this.query.limit === PaginationLimit.NO_PAGINATION) return defaultLimit

        return Math.min(this.query.limit ?? defaultLimit, maxLimit)
    }

    applyPagination() {
        const page = positiveNumberOrDefault(this.query.page, 1, 1)

        const limit = this.paginationLimit

        if (!this.isPaginated) return this

        // Allow user to choose between limit/offset and take/skip.
        // However, using limit/offset can cause problems when joining one-to-many etc.
        if (this.config.paginationType === PaginationType.LIMIT_AND_OFFSET) {
            this.queryBuilder.limit(limit).offset((page - 1) * limit)
        } else {
            this.queryBuilder.take(limit).skip((page - 1) * limit)
        }

        return this
    }

    private getSearchableColumns() {
        const searchBy: Column<T>[] = []

        if (!this.query.searchBy || this.config.ignoreSearchByInQueryParam) {
            searchBy.push(...this.config.searchableColumns)
            return searchBy
        }

        for (const column of this.query.searchBy) {
            if (isEntityKey(this.config.searchableColumns, column)) {
                searchBy.push(column)
            }
        }

        return searchBy
    }

    applySearch() {
        const searchableColumns: Column<T>[] = this.getSearchableColumns()

        if (!this.query.search || !searchableColumns.length) return

        this.queryBuilder.andWhere(
            new Brackets((qb: SelectQueryBuilder<T>) => {
                for (const column of searchableColumns) {
                    const property = getPropertiesByColumnName(column)
                    const { isVirtualProperty, query: virtualQuery } = extractVirtualProperty(qb, property)
                    const isRelation = checkIsRelation(qb, property.propertyPath)
                    const isEmbedded = checkIsEmbedded(qb, property.propertyPath)

                    const alias = fixColumnAlias(
                        property,
                        qb.alias,
                        isRelation,
                        isVirtualProperty,
                        isEmbedded,
                        virtualQuery
                    )

                    const condition: WherePredicateOperator = {
                        operator: 'ilike',
                        parameters: [alias, `:${property.column}`],
                    }

                    if (['postgres', 'cockroachdb'].includes(this.queryBuilder.connection.options.type)) {
                        condition.parameters[0] = `CAST(${condition.parameters[0]} AS text)`
                    }

                    qb.orWhere(qb['createWhereConditionExpression'](condition), {
                        [property.column]: `%${this.query.search}%`,
                    })
                }
            })
        )
    }

    async getPaginatedResponse(): Promise<Paginated<T>> {
        const items = await this.queryBuilder.getMany()
        const totalItems = await this.queryBuilder.clone().skip(0).take(Infinity).getCount()

        const limit = this.paginationLimit
        const page = positiveNumberOrDefault(this.query.page, 1, 1)
        const selectParams = this.config.select
        // const searchBy = this.config.searchBy
        const isQuerySelected = selectParams && selectParams.length > 0
        const isPaginated = this.isPaginated

        const response: Paginated<T> = {
            data: items,

            meta: {
                itemsPerPage: limit === PaginationLimit.COUNTER_ONLY ? totalItems : isPaginated ? limit : items.length,
                totalItems: limit === PaginationLimit.COUNTER_ONLY || isPaginated ? totalItems : items.length,
                currentPage: page,
            } as any,
        } as any

        return Object.assign(new Paginated(), response)
    }
}

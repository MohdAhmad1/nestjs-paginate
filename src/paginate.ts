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
    getQueryUrlComponents,
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
import { stringify } from 'querystring'
import { mapKeys } from 'lodash'

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
    private searchableColumns: Column<T>[] = []
    private sortableColumns: SortBy<T> = []
    private selectableColumns: (Column<T> | (string & {}))[] = undefined

    constructor(repo: Repository<T> | SelectQueryBuilder<T>, query: PaginateQuery, config: PaginateConfig<T>) {
        const queryBuilder = this.initialize(repo, config)

        this.config = config
        this.query = query
        this._queryBuilder = queryBuilder

        this.getSearchableColumns()
        this.getSortableColumns()
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

        this.selectableColumns = selectParams

        if (!includesAllPrimaryKeyColumns(this.queryBuilder, selectParams)) {
            return this
        }

        const cols: string[] = selectParams?.reduce((cols, currentCol) => {
            const columnProperties = getPropertiesByColumnName(currentCol)
            const isRelation = checkIsRelation(this.queryBuilder, columnProperties.propertyPath)
            cols.push(fixColumnAlias(columnProperties, this.queryBuilder.alias, isRelation))
            return cols
        }, [])

        if (cols) {
            this.queryBuilder.select(cols)
        }

        return this
    }

    applyFilters() {
        if (this.query.filter) {
            addFilter(this.queryBuilder, this.query, this.config.filterableColumns)
        }

        return this
    }

    private getSortableColumns() {
        const sortBy = [] as SortBy<T>

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

        this.sortableColumns = sortBy
    }

    applySorting() {
        const dbType = this.queryBuilder.connection.options.type
        const isMariaDbOrMySql = (dbType: string) => dbType === 'mariadb' || dbType === 'mysql'
        const isMMDb = isMariaDbOrMySql(dbType)

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

        for (const order of this.sortableColumns) {
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
        if (!this.config.searchableColumns?.length) return

        if (!this.query.searchBy || this.config.ignoreSearchByInQueryParam) {
            this.searchableColumns.push(...this.config.searchableColumns)
            return
        }

        for (const column of this.query.searchBy) {
            if (isEntityKey(this.config.searchableColumns, column)) {
                this.searchableColumns.push(column)
            }
        }
    }

    applySearch() {
        if (!this.query.search || !this.searchableColumns.length) return

        this.queryBuilder.andWhere(
            new Brackets((qb: SelectQueryBuilder<T>) => {
                for (const column of this.searchableColumns) {
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
        let [items, totalItems]: [T[], number] = [[], 0]

        const limit = this.paginationLimit
        const page = this.query.page > 0 ? this.query.page : 1
        const isPaginated = this.isPaginated

        if (this.query.limit === PaginationLimit.COUNTER_ONLY) {
            totalItems = await this.queryBuilder.getCount()
        } else if (isPaginated) {
            ;[items, totalItems] = await this.queryBuilder.getManyAndCount()
        } else {
            items = await this.queryBuilder.getMany()
        }

        const sortByQuery = this.sortableColumns?.map((order) => `&sortBy=${order.join(':')}`).join('')
        const searchQuery = this.query.search ? `&search=${this.query.search}` : ''

        const searchByQuery =
            this.query.searchBy?.length && !this.config.ignoreSearchByInQueryParam
                ? this.searchableColumns.map((column) => `&searchBy=${column}`).join('')
                : ''

        // Only expose select in meta data if query select differs from config select
        const isQuerySelected =
            this.selectableColumns?.length !== this.config.select?.length && !this.config.ignoreSelectInQueryParam
        const selectQuery = isQuerySelected ? `&select=${this.selectableColumns?.join(',')}` : ''

        const filterQuery = this.query.filter
            ? '&' +
              stringify(
                  mapKeys(this.query.filter, (_param, name) => 'filter.' + name),
                  '&',
                  '=',
                  { encodeURIComponent: (str) => str }
              )
            : ''

        const options = `&limit=${limit}${sortByQuery}${searchQuery}${searchByQuery}${selectQuery}${filterQuery}`

        let path: string = null
        if (this.query.path !== null) {
            // `query.path` does not exist in RPC/WS requests and is set to null then.
            const { queryOrigin, queryPath } = getQueryUrlComponents(this.query.path)
            if (this.config.relativePath) {
                path = queryPath
            } else if (this.config.origin) {
                path = this.config.origin + queryPath
            } else {
                path = queryOrigin + queryPath
            }
        }
        const buildLink = (p: number): string => path + '?page=' + p + options

        const totalPages = this.isPaginated ? Math.ceil(totalItems / limit) : 1

        const results: Paginated<T> = {
            data: items,
            meta: {
                itemsPerPage: limit === PaginationLimit.COUNTER_ONLY ? totalItems : isPaginated ? limit : items.length,
                totalItems: limit === PaginationLimit.COUNTER_ONLY || isPaginated ? totalItems : items.length,
                currentPage: page,
                totalPages,
                sortBy: this.sortableColumns,
                search: this.query.search,
                searchBy: this.query.search ? this.searchableColumns : undefined,
                select: isQuerySelected ? this.selectableColumns : undefined,
                filter: this.query.filter,
            },
            // If there is no `path`, don't build links.
            links:
                path !== null
                    ? {
                          first: page == 1 ? undefined : buildLink(1),
                          previous: page - 1 < 1 ? undefined : buildLink(page - 1),
                          current: buildLink(page),
                          next: page + 1 > totalPages ? undefined : buildLink(page + 1),
                          last: page == totalPages || !totalItems ? undefined : buildLink(totalPages),
                      }
                    : ({} as Paginated<T>['links']),
        }

        return Object.assign(new Paginated(), results)
    }
}

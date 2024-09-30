import { Logger, ServiceUnavailableException } from '@nestjs/common'
import { FindOptionsRelations, FindOptionsUtils, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm'
import { OrmUtils } from 'typeorm/util/OrmUtils'
import { PaginateQuery } from './decorator'
import { addFilter } from './filter'
import {
    checkIsEmbedded,
    checkIsRelation,
    extractVirtualProperty,
    fixColumnAlias,
    generateWhereStatement,
    getPaginationLimit,
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

const logger: Logger = new Logger('nestjs-paginate')

export async function paginate<T extends ObjectLiteral>(
    query: PaginateQuery,
    repo: Repository<T> | SelectQueryBuilder<T>,
    config: PaginateConfig<T>
): Promise<Paginated<T>> {
    const queryBuilder = new NestJsPaginate(repo, query, config)

    queryBuilder.applyColumnsSelection().applyFilters().applyPagination().applySorting()

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

        const cols: string[] = selectParams.reduce((cols, currentCol) => {
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

        if (this.query.sortBy) {
            for (const order of this.query.sortBy) {
                if (isEntityKey(this.config.sortableColumns, order[0]) && ['ASC', 'DESC'].includes(order[1])) {
                    sortBy.push(order as Order<T>)
                }
            }
        }

        if (!sortBy.length) {
            sortBy.push(...(this.config.defaultSortBy || [[this.config.sortableColumns[0], 'ASC']]))
        }

        for (const order of sortBy) {
            const columnProperties = getPropertiesByColumnName(order[0])
            const { isVirtualProperty } = extractVirtualProperty(this.queryBuilder, columnProperties)
            const isRelation = checkIsRelation(this.queryBuilder, columnProperties.propertyPath)
            const isEmbeded = checkIsEmbedded(this.queryBuilder, columnProperties.propertyPath)

            let alias = fixColumnAlias(
                columnProperties,
                this.queryBuilder.alias,
                isRelation,
                isVirtualProperty,
                isEmbeded
            )

            if (isMMDb) {
                if (isVirtualProperty) {
                    alias = `\`${alias}\``
                }
                if (nullSort) {
                    this.queryBuilder.addOrderBy(`${alias} ${nullSort}`)
                }
                this.queryBuilder.addOrderBy(alias, order[1])
            } else {
                if (isVirtualProperty) {
                    alias = `"${alias}"`
                }
                this.queryBuilder.addOrderBy(alias, order[1], nullSort as 'NULLS FIRST' | 'NULLS LAST' | undefined)
            }
        }

        return this
    }

    applyPagination() {
        const page = positiveNumberOrDefault(this.query.page, 1, 1)

        const maxLimit = this.config.maxLimit || PaginationLimit.DEFAULT_MAX_LIMIT

        const isPaginated = !(
            this.query.limit === PaginationLimit.COUNTER_ONLY ||
            (this.query.limit === PaginationLimit.NO_PAGINATION && maxLimit === PaginationLimit.NO_PAGINATION)
        )

        const limit = getPaginationLimit(this.query, true, this.config)

        if (!isPaginated) return this

        // Allow user to choose between limit/offset and take/skip.
        // However, using limit/offset can cause problems when joining one-to-many etc.
        if (this.config.paginationType === PaginationType.LIMIT_AND_OFFSET) {
            this.queryBuilder.limit(limit).offset((page - 1) * limit)
        } else {
            this.queryBuilder.take(limit).skip((page - 1) * limit)
        }

        return this
    }

    async getPaginatedResponse(): Promise<Paginated<T>> {
        const response = new Paginated<T>()

        response.data = await this.queryBuilder.getMany()

        return response
    }
}

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
    const queryBuilder = NestJsPaginate.initialize(repo, config)

    NestJsPaginate.applyFilters(query, queryBuilder, config)
    NestJsPaginate.applySorting(query, queryBuilder, config)
    NestJsPaginate.applyColumnsSelection(query, queryBuilder, config)
    NestJsPaginate.applyPagination(query, queryBuilder, config)
    return NestJsPaginate.getPaginatedResponse(query, queryBuilder, config)
}

function getPaginationLimit<T extends ObjectLiteral>(
    query: PaginateQuery,
    isPaginated: boolean,
    config: PaginateConfig<T>
) {
    const defaultLimit = config.defaultLimit || PaginationLimit.DEFAULT_LIMIT
    const maxLimit = config.maxLimit || PaginationLimit.DEFAULT_MAX_LIMIT

    if (query.limit === PaginationLimit.COUNTER_ONLY) {
        return PaginationLimit.COUNTER_ONLY
    }

    if (!isPaginated) return defaultLimit

    if (maxLimit === PaginationLimit.NO_PAGINATION) {
        return query.limit ?? defaultLimit
    }

    if (query.limit === PaginationLimit.NO_PAGINATION) {
        return defaultLimit
    }

    return Math.min(query.limit ?? defaultLimit, maxLimit)
}

export class NestJsPaginate {
    static initialize<T extends ObjectLiteral>(repo: Repository<T> | SelectQueryBuilder<T>, config: PaginateConfig<T>) {
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

    static applyColumnsSelection<T extends ObjectLiteral>(
        query: PaginateQuery,
        queryBuilder: SelectQueryBuilder<T>,
        config: PaginateConfig<T>
    ) {
        let selectParams =
            config.select && query.select && !config.ignoreSelectInQueryParam
                ? config.select.filter((column) => query.select.includes(column))
                : config.select

        if (!includesAllPrimaryKeyColumns(queryBuilder, query.select)) {
            selectParams = config.select
        }

        const cols: string[] = selectParams.reduce((cols, currentCol) => {
            const columnProperties = getPropertiesByColumnName(currentCol)
            const isRelation = checkIsRelation(queryBuilder, columnProperties.propertyPath)
            cols.push(fixColumnAlias(columnProperties, queryBuilder.alias, isRelation))
            return cols
        }, [])

        queryBuilder.select(cols)

        return queryBuilder
    }

    static applyFilters<T extends ObjectLiteral>(
        query: PaginateQuery,
        queryBuilder: SelectQueryBuilder<T>,
        config: PaginateConfig<T>
    ) {
        if (query.filter) {
            addFilter(queryBuilder, query, config.filterableColumns)
        }

        return queryBuilder
    }

    static applySorting<T extends ObjectLiteral>(
        query: PaginateQuery,
        queryBuilder: SelectQueryBuilder<T>,
        config: PaginateConfig<T>
    ) {
        const dbType = queryBuilder.connection.options.type
        const isMariaDbOrMySql = (dbType: string) => dbType === 'mariadb' || dbType === 'mysql'
        const isMMDb = isMariaDbOrMySql(dbType)

        const sortBy = [] as SortBy<T>

        let nullSort: string | undefined
        if (config.nullSort) {
            if (isMMDb) {
                nullSort = config.nullSort === 'last' ? 'IS NULL' : 'IS NOT NULL'
            } else {
                nullSort = config.nullSort === 'last' ? 'NULLS LAST' : 'NULLS FIRST'
            }
        }

        if (config.sortableColumns.length < 1) {
            const message = "Missing required 'sortableColumns' config."
            logger.debug(message)
            throw new ServiceUnavailableException(message)
        }

        if (query.sortBy) {
            for (const order of query.sortBy) {
                if (isEntityKey(config.sortableColumns, order[0]) && ['ASC', 'DESC'].includes(order[1])) {
                    sortBy.push(order as Order<T>)
                }
            }
        }

        if (!sortBy.length) {
            sortBy.push(...(config.defaultSortBy || [[config.sortableColumns[0], 'ASC']]))
        }

        for (const order of sortBy) {
            const columnProperties = getPropertiesByColumnName(order[0])
            const { isVirtualProperty } = extractVirtualProperty(queryBuilder, columnProperties)
            const isRelation = checkIsRelation(queryBuilder, columnProperties.propertyPath)
            const isEmbeded = checkIsEmbedded(queryBuilder, columnProperties.propertyPath)

            let alias = fixColumnAlias(columnProperties, queryBuilder.alias, isRelation, isVirtualProperty, isEmbeded)

            if (isMMDb) {
                if (isVirtualProperty) {
                    alias = `\`${alias}\``
                }
                if (nullSort) {
                    queryBuilder.addOrderBy(`${alias} ${nullSort}`)
                }
                queryBuilder.addOrderBy(alias, order[1])
            } else {
                if (isVirtualProperty) {
                    alias = `"${alias}"`
                }
                queryBuilder.addOrderBy(alias, order[1], nullSort as 'NULLS FIRST' | 'NULLS LAST' | undefined)
            }
        }
    }

    static applyPagination<T extends ObjectLiteral>(
        query: PaginateQuery,
        queryBuilder: SelectQueryBuilder<T>,
        config: PaginateConfig<T>
    ) {
        const page = positiveNumberOrDefault(query.page, 1, 1)

        const maxLimit = config.maxLimit || PaginationLimit.DEFAULT_MAX_LIMIT

        const isPaginated = !(
            query.limit === PaginationLimit.COUNTER_ONLY ||
            (query.limit === PaginationLimit.NO_PAGINATION && maxLimit === PaginationLimit.NO_PAGINATION)
        )

        const limit = getPaginationLimit(query, true, config)

        if (!isPaginated) return queryBuilder

        // Allow user to choose between limit/offset and take/skip.
        // However, using limit/offset can cause problems when joining one-to-many etc.
        if (config.paginationType === PaginationType.LIMIT_AND_OFFSET) {
            queryBuilder.limit(limit).offset((page - 1) * limit)
        } else {
            queryBuilder.take(limit).skip((page - 1) * limit)
        }

        return queryBuilder
    }

    static async getPaginatedResponse<T extends ObjectLiteral>(
        query: PaginateQuery,
        queryBuilder: SelectQueryBuilder<T>,
        config: PaginateConfig<T>
    ): Promise<Paginated<T>> {
        const response = new Paginated<T>()

        response.data = await queryBuilder.getMany()

        return response
    }
}

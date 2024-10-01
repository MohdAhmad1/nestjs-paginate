import { FindOptionsRelations, FindOptionsUtils, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm'
import { OrmUtils } from 'typeorm/util/OrmUtils'
import { addFilter } from './common/filter'
import { buildLinks } from './common/linkBuilder'
import { addSearch } from './common/search'
import { addSort } from './common/sort'
import { PaginateQuery } from './decorator'
import {
    checkIsRelation,
    Column,
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
    public readonly config: PaginateConfig<T>
    public readonly query: PaginateQuery
    public readonly _queryBuilder: SelectQueryBuilder<T>
    public readonly searchableColumns: Column<T>[] = []
    public readonly sortableColumns: SortBy<T> = []
    // eslint-disable-next-line @typescript-eslint/ban-types
    public selectableColumns: (Column<T> | (string & {}))[] = undefined
    private readonly _isPaginated: boolean
    private readonly _paginationLimit: number

    constructor(repo: Repository<T> | SelectQueryBuilder<T>, query: PaginateQuery, config: PaginateConfig<T>) {
        const queryBuilder = this.initialize(repo, config)

        this.config = config
        this.query = query
        this._queryBuilder = queryBuilder

        this.getSearchableColumns()
        this.getSortableColumns()

        this._isPaginated = this.getIsPaginated()
        this._paginationLimit = this.getPaginationLimit()
    }

    // Getters
    public get queryBuilder() {
        return this._queryBuilder
    }

    public get isPaginated() {
        return this._isPaginated
    }

    public get paginationLimit() {
        return this._paginationLimit
    }

    public get isQuerySelected() {
        return this.selectableColumns?.length !== this.config.select?.length && !this.config.ignoreSelectInQueryParam
    }

    // Initializers
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

    private getSortableColumns() {
        // Add provided sort by columns
        this.query.sortBy?.forEach((order) => {
            const isValidColumn = isEntityKey(this.config.sortableColumns, order[0])

            const isValidSortBy = ['ASC', 'DESC'].includes(order[1].toUpperCase())

            if (!isValidColumn && isValidSortBy) return

            this.sortableColumns.push(order as Order<T>)
        })

        if (!this.sortableColumns.length) {
            const defaultSortBy = this.config.defaultSortBy || [[this.config.sortableColumns[0], 'ASC']]

            this.sortableColumns.push(defaultSortBy[0])
        }
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

    private getIsPaginated() {
        const maxLimit = this.config.maxLimit || PaginationLimit.DEFAULT_MAX_LIMIT

        if (this.query.limit === PaginationLimit.COUNTER_ONLY) return false

        if (this.query.limit === PaginationLimit.NO_PAGINATION && maxLimit === PaginationLimit.NO_PAGINATION)
            return false

        return true
    }

    private getPaginationLimit() {
        if (this.query.limit === PaginationLimit.COUNTER_ONLY) return PaginationLimit.COUNTER_ONLY

        const defaultLimit = this.config.defaultLimit || PaginationLimit.DEFAULT_LIMIT
        const maxLimit = this.config.maxLimit || PaginationLimit.DEFAULT_MAX_LIMIT

        if (!this.isPaginated) return defaultLimit

        if (maxLimit === PaginationLimit.NO_PAGINATION) return this.query.limit ?? defaultLimit

        if (this.query.limit === PaginationLimit.NO_PAGINATION) return defaultLimit

        return Math.min(this.query.limit ?? defaultLimit, maxLimit)
    }

    // Public Methods

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

        const cols: string[] = this.selectableColumns.reduce((cols, currentCol) => {
            const columnProperties = getPropertiesByColumnName(currentCol)
            const isRelation = checkIsRelation(this.queryBuilder, columnProperties.propertyPath)
            cols.push(fixColumnAlias(columnProperties, this.queryBuilder.alias, isRelation))
            return cols
        }, [])

        if (cols.length) {
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

    applySorting() {
        addSort(this)

        return this
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

    applySearch() {
        addSearch(this)
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

        const totalPages = this.isPaginated ? Math.ceil(totalItems / limit) : 1

        const links = buildLinks(this, totalItems)

        const results: Paginated<T> = {
            data: items,
            meta: {
                itemsPerPage: 0,
                totalItems: limit === PaginationLimit.COUNTER_ONLY || isPaginated ? totalItems : items.length,
                currentPage: page,
                totalPages,
                sortBy: this.sortableColumns,
                search: this.query.search,
                searchBy: this.query.search ? this.searchableColumns : undefined,
                select: this.isQuerySelected ? this.selectableColumns : undefined,
                filter: this.query.filter,
            },
            links,
        }

        if (limit === PaginationLimit.COUNTER_ONLY) {
            results.meta.itemsPerPage = totalItems
        } else if (isPaginated) {
            results.meta.itemsPerPage = limit
        } else {
            results.meta.itemsPerPage = items.length
        }

        return Object.assign(new Paginated(), results)
    }
}

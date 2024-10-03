import { Logger } from '@nestjs/common'
import { FindOperator, FindOptionsWhere, Repository, SelectQueryBuilder } from 'typeorm'
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata'
import { Column, ColumnProperties } from './types'

export function isEntityKey<T>(entityColumns: Column<T>[], column: string): column is Column<T> {
    return !!entityColumns.find((c) => c === column)
}

export function positiveNumberOrDefault(value: number | undefined, defaultValue: number, minValue: 0 | 1 = 0) {
    if (value === undefined || value < minValue) {
        return defaultValue
    }

    return value
}

export function getPropertiesByColumnName(column: string): ColumnProperties {
    const propertyPath = column.split('.')

    if (propertyPath.length <= 1) {
        return { propertyName: propertyPath[0], isNested: false, column: propertyPath[0] }
    }

    const propertyNamePath = propertyPath.slice(1)

    let isNested = false
    let propertyName = propertyNamePath.join('.')

    if (!propertyName.startsWith('(') && propertyNamePath.length > 1) {
        isNested = true
    }

    propertyName = propertyName.replace('(', '').replace(')', '')

    return {
        propertyPath: propertyPath[0],
        propertyName, // the join is in case of an embedded entity
        isNested,
        column: `${propertyPath[0]}.${propertyName}`,
    }
}

export function extractVirtualProperty(
    qb: SelectQueryBuilder<unknown>,
    columnProperties: ColumnProperties
): { isVirtualProperty: boolean; query?: ColumnMetadata['query'] } {
    const metadata = columnProperties.propertyPath
        ? qb?.expressionMap?.mainAlias?.metadata?.findColumnWithPropertyPath(columnProperties.propertyPath)
              ?.referencedColumn?.entityMetadata // on relation
        : qb?.expressionMap?.mainAlias?.metadata

    return (
        metadata?.columns?.find((column) => column.propertyName === columnProperties.propertyName) || {
            isVirtualProperty: false,
            query: undefined,
        }
    )
}
export function includesAllPrimaryKeyColumns(qb: SelectQueryBuilder<unknown>, propertyPath: string[]): boolean {
    if (!qb || !propertyPath) {
        return false
    }

    return qb.expressionMap.mainAlias?.metadata?.primaryColumns
        .map((column) => column.propertyPath)
        .every((column) => propertyPath.includes(column))
}

export function hasColumnWithPropertyPath(
    qb: SelectQueryBuilder<unknown>,
    columnProperties: ColumnProperties
): boolean {
    if (!qb || !columnProperties) {
        return false
    }
    return !!qb.expressionMap.mainAlias?.metadata?.hasColumnWithPropertyPath(columnProperties.propertyName)
}

export function checkIsRelation(qb: SelectQueryBuilder<unknown>, propertyPath: string): boolean {
    if (!qb || !propertyPath) {
        return false
    }
    return !!qb?.expressionMap?.mainAlias?.metadata?.hasRelationWithPropertyPath(propertyPath)
}

export function checkIsEmbedded(qb: SelectQueryBuilder<unknown>, propertyPath: string): boolean {
    if (!qb || !propertyPath) {
        return false
    }
    return !!qb?.expressionMap?.mainAlias?.metadata?.hasEmbeddedWithPropertyPath(propertyPath)
}

export function checkIsArray(qb: SelectQueryBuilder<unknown>, propertyName: string): boolean {
    if (!qb || !propertyName) {
        return false
    }
    return !!qb?.expressionMap?.mainAlias?.metadata.findColumnWithPropertyName(propertyName)?.isArray
}

// This function is used to fix the column alias when using relation, embedded or virtual properties
export function fixColumnAlias(
    properties: ColumnProperties,
    alias: string,
    isRelation = false,
    isVirtualProperty = false,
    isEmbedded = false,
    query?: ColumnMetadata['query']
): string {
    if (isVirtualProperty) {
        return query ? `(${query(alias)})` : `${alias}_${properties.propertyName}`
    }

    if (isEmbedded) {
        return `${alias}.${properties.propertyPath}.${properties.propertyName}`
    }

    if (!isRelation) {
        return properties.propertyName
    }

    // relation is true
    if (isVirtualProperty && query) {
        return `(${query(alias + '_' + properties.propertyPath + '_rel')})` // () is needed to avoid parameter conflict
    }

    if ((isVirtualProperty && !query) || properties.isNested) {
        if (properties.propertyName.includes('.')) {
            const propertyPath = properties.propertyName.split('.')
            const nestedRelations = propertyPath
                .slice(0, -1)
                .map((v) => `${v}_rel`)
                .join('_')
            const nestedCol = propertyPath[propertyPath.length - 1]

            return `${alias}_${properties.propertyPath}_rel_${nestedRelations}.${nestedCol}`
        } else {
            return `${alias}_${properties.propertyPath}_rel_${properties.propertyName}`
        }
    }

    return `${alias}_${properties.propertyPath}_rel.${properties.propertyName}`
}

export function getQueryUrlComponents(path: string): { queryOrigin: string; queryPath: string } {
    const r = new RegExp('^(?:[a-z+]+:)?//', 'i')
    let queryOrigin = ''
    let queryPath = ''
    if (r.test(path)) {
        const url = new URL(path)
        queryOrigin = url.origin
        queryPath = url.pathname
    } else {
        queryPath = path
    }
    return { queryOrigin, queryPath }
}

const isoDateRegExp = new RegExp(
    /(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))/
)

export function isISODate(str: string): boolean {
    return isoDateRegExp.test(str)
}

export function isRepository<T>(repo: unknown | Repository<T>): repo is Repository<T> {
    if (repo instanceof Repository) return true
    try {
        if (Object.getPrototypeOf(repo).constructor.name === 'Repository') return true
        return typeof repo === 'object' && !('connection' in repo) && 'manager' in repo
    } catch {
        return false
    }
}

export function isFindOperator<T>(value: unknown | FindOperator<T>): value is FindOperator<T> {
    if (value instanceof FindOperator) return true
    try {
        if (Object.getPrototypeOf(value).constructor.name === 'FindOperator') return true
        return typeof value === 'object' && '_type' in value && '_value' in value
    } catch {
        return false
    }
}

export function generateWhereStatement<T>(
    queryBuilder: SelectQueryBuilder<T>,
    obj: FindOptionsWhere<T> | FindOptionsWhere<T>[]
) {
    const toTransform = Array.isArray(obj) ? obj : [obj]
    return toTransform.map((item) => flattenWhereAndTransform(queryBuilder, item).join(' AND ')).join(' OR ')
}

export function flattenWhereAndTransform<T>(
    queryBuilder: SelectQueryBuilder<T>,
    obj: FindOptionsWhere<T>,
    separator = '.',
    parentKey = ''
) {
    return Object.entries(obj).flatMap(([key, value]) => {
        if (obj.hasOwnProperty(key)) {
            const joinedKey = parentKey ? `${parentKey}${separator}${key}` : key

            if (typeof value === 'object' && value !== null && !isFindOperator(value)) {
                return flattenWhereAndTransform(queryBuilder, value as FindOptionsWhere<T>, separator, joinedKey)
            } else {
                const property = getPropertiesByColumnName(joinedKey)
                const { isVirtualProperty, query: virtualQuery } = extractVirtualProperty(queryBuilder, property)
                const isRelation = checkIsRelation(queryBuilder, property.propertyPath)
                const isEmbedded = checkIsEmbedded(queryBuilder, property.propertyPath)
                const alias = fixColumnAlias(
                    property,
                    queryBuilder.alias,
                    isRelation,
                    isVirtualProperty,
                    isEmbedded,
                    virtualQuery
                )
                const whereClause = queryBuilder['createWhereConditionExpression'](
                    queryBuilder['getWherePredicateCondition'](alias, value)
                )

                const allJoinedTables = queryBuilder.expressionMap.joinAttributes.reduce(
                    (acc, attr) => {
                        acc[attr.alias.name] = true
                        return acc
                    },
                    {} as Record<string, boolean>
                )

                const allTablesInPath = property.column.split('.').slice(0, -1)
                const tablesToJoin = allTablesInPath.map((table, idx) => {
                    if (idx === 0) {
                        return table
                    }
                    return [...allTablesInPath.slice(0, idx), table].join('.')
                })

                tablesToJoin.forEach((table) => {
                    const pathSplit = table.split('.')
                    const fullPath =
                        pathSplit.length === 1
                            ? ''
                            : `_${pathSplit
                                  .slice(0, -1)
                                  .map((p) => p + '_rel')
                                  .join('_')}`
                    const tableName = pathSplit[pathSplit.length - 1]
                    const tableAliasWithProperty = `${queryBuilder.alias}${fullPath}.${tableName}`
                    const joinTableAlias = `${queryBuilder.alias}${fullPath}_${tableName}_rel`

                    const baseTableAlias = allJoinedTables[joinTableAlias]

                    if (baseTableAlias) {
                        return
                    } else {
                        queryBuilder.leftJoin(tableAliasWithProperty, joinTableAlias)
                    }
                })

                return whereClause
            }
        }
    })
}

export const logger: Logger = new Logger('nestjs-paginate')

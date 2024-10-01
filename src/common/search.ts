import {
    checkIsEmbedded,
    checkIsRelation,
    extractVirtualProperty,
    fixColumnAlias,
    getPropertiesByColumnName,
} from '../helper'
import { NestJsPaginate } from '../paginate'
import { Brackets, SelectQueryBuilder } from 'typeorm'
import { WherePredicateOperator } from 'typeorm/query-builder/WhereClause'

export function addSearch(nestjsPaginate: NestJsPaginate<any>) {
    const queryBuilder = nestjsPaginate.queryBuilder
    const searchableColumns = nestjsPaginate.searchableColumns
    const searchTerm = nestjsPaginate.query.search

    if (!searchableColumns.length || !searchTerm) return

    queryBuilder.andWhere(
        new Brackets((qb: SelectQueryBuilder<any>) => {
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

                if (['postgres', 'cockroachdb'].includes(queryBuilder.connection.options.type)) {
                    condition.parameters[0] = `CAST(${condition.parameters[0]} AS text)`
                }

                qb.orWhere(qb['createWhereConditionExpression'](condition), {
                    [property.column]: `%${searchTerm}%`,
                })
            }
        })
    )
}

import { ColumnProperties } from 'types'
import { SelectQueryBuilder } from 'typeorm'

export function hasColumnWithPropertyPath(
    qb: SelectQueryBuilder<unknown>,
    columnProperties: ColumnProperties
): boolean {
    if (!qb || !columnProperties) {
        return false
    }
    return !!qb.expressionMap.mainAlias?.metadata?.hasColumnWithPropertyPath(columnProperties.propertyName)
}

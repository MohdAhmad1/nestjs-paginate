import { ColumnProperties } from 'types'
import { SelectQueryBuilder } from 'typeorm'
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata'

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

import { ColumnProperties } from 'types'

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

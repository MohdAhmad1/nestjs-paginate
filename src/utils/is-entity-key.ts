import { Column } from 'types'

export function isEntityKey<T>(entityColumns: Column<T>[], column: string): column is Column<T> {
    return !!entityColumns.find((c) => c === column)
}

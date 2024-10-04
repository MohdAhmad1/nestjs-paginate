export * from './is-entity-key'
export * from './positive-number-or-default'
export * from './get-properties-by-column'
export * from './extract-virtual-property'
export * from './includes-all-primary-key-columns'

import { Logger } from '@nestjs/common'

const isoDateRegExp = new RegExp(
    /(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))/
)

export function isISODate(str: string): boolean {
    return isoDateRegExp.test(str)
}

export const logger: Logger = new Logger('nestjs-paginate')

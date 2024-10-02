import { NestJsPaginate } from 'src/paginate'
import { PaginationLimit } from 'src/types'

export async function fetchRecords(qb: NestJsPaginate<any>) {
    if (this.query.limit === PaginationLimit.COUNTER_ONLY) {
        const totalItems = await qb.queryBuilder.getCount()
        const items = []

        return {
            items,
            totalItems,
        }
    }

    if (qb.isPaginated) {
        const [items, totalItems] = await qb.queryBuilder.getManyAndCount()

        return {
            items,
            totalItems,
        }
    }

    const items = await qb.queryBuilder.getMany()

    return {
        items,
        totalItems: items.length,
    }
}

import * as Knex from 'knex'

const TABLE_NAME = ''

export async function up (knex: Knex): Promise<any> {
  knex.schema.createTable(TABLE_NAME, () => {
  })
}

export async function down (knex: Knex): Promise<any> {
  knex.schema.dropTable(TABLE_NAME)
}

import fs from "fs"
import path from "path"
import {JSONSchema} from "json-schema-to-ts"

function isNotJSONSchemaArray(schema: JSONSchema | ReadonlyArray<JSONSchema>): schema is JSONSchema {
  return !Array.isArray(schema)
}

function collapseExamples(schema: JSONSchema): JSONSchema {
  if (typeof schema !== "object" || schema === null) {
    return schema
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = {...schema}

  if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    result.example = schema.examples[0]
    delete result.examples
  }

  if (schema.items) {
    if (isNotJSONSchemaArray(schema.items)) {
      result.items = collapseExamples(schema.items)
    } else {
      result.items = schema.items.map(collapseExamples)
    }
  }

  if (schema.properties) {
    const properties: Record<string, JSONSchema> = {}
    for (const key in schema.properties) {
      if (Object.prototype.hasOwnProperty.call(schema.properties, key)) {
        properties[key] = collapseExamples(schema.properties[key])
      }
    }
    result.properties = properties
  }

  return result
}

export function writeSchemas(
  schemas: Record<string, JSONSchema>,
  outputDir: string
): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, {recursive: true})
  }
  for (const name in schemas) {
    if (Object.prototype.hasOwnProperty.call(schemas, name)) {
      const schema = schemas[name]
      const fileName = `${name}.json`
      const filePath = path.join(outputDir, fileName)

      try {
        fs.writeFileSync(filePath, JSON.stringify(collapseExamples(schema), null, 2))
        console.log(`Schema ${fileName} written successfully.`)
      } catch (error) {
        console.error(`Error writing schema ${fileName}:`, error)
      }
    }
  }
}

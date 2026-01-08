import fs from "fs"
import path from "path"
import {
  describe,
  test,
  beforeEach,
  afterEach,
  expect,
  vi
} from "vitest"
import {writeSchemas} from "../../src/specifications/writeSchemas"

describe("writeSchemas", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("creates output directory and writes schemas with collapsed examples", () => {
    const schemas = {
      patient: {
        type: "object",
        examples: [{foo: "bar"}, {foo: "baz"}],
        properties: {
          id: {
            type: "string",
            examples: ["123", "456"]
          },
          nested: {
            type: "object",
            properties: {
              items: {
                type: "array",
                examples: [["item-1"], ["item-2"]],
                items: {
                  type: "string",
                  examples: ["deep-value"]
                }
              }
            }
          }
        }
      }
    } as const

    const outputDir = "schemas"
    const writes: Record<string, string> = {}

    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false)
    const mkdirSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined)
    vi.spyOn(fs, "writeFileSync").mockImplementation((filePath, data) => {
      writes[filePath.toString()] = data.toString()
    })

    writeSchemas(schemas, outputDir)

    expect(existsSpy).toHaveBeenCalledWith(outputDir)
    expect(mkdirSpy).toHaveBeenCalledWith(outputDir, {recursive: true})

    const writtenSchema = JSON.parse(
      writes[path.join(outputDir, "patient.json")]
    )

    expect(writtenSchema.example).toEqual({foo: "bar"})
    expect(writtenSchema.examples).toBeUndefined()
    expect(writtenSchema.properties.id.example).toBe("123")
    expect(writtenSchema.properties.id.examples).toBeUndefined()
    expect(writtenSchema.properties.nested.properties.items.example).toEqual(["item-1"])
    expect(writtenSchema.properties.nested.properties.items.examples).toBeUndefined()
    expect(writtenSchema.properties.nested.properties.items.items.example).toBe("deep-value")
  })

  test("collapses examples within array based items and nested properties", () => {
    const schemas = {
      collection: {
        type: "array",
        items: [
          {
            type: "string",
            examples: ["first"]
          },
          {
            type: "object",
            properties: {
              flag: {
                type: "boolean",
                examples: [true, false]
              }
            }
          }
        ]
      }
    } as const

    const outputDir = "arrays"
    const writes: Record<string, string> = {}

    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    vi.spyOn(fs, "writeFileSync").mockImplementation((filePath, data) => {
      writes[filePath.toString()] = data.toString()
    })

    writeSchemas(schemas, outputDir)

    const writtenSchema = JSON.parse(
      writes[path.join(outputDir, "collection.json")]
    )

    expect(Array.isArray(writtenSchema.items)).toBe(true)
    expect(writtenSchema.items[0].example).toBe("first")
    expect(writtenSchema.items[0].examples).toBeUndefined()
    expect(writtenSchema.items[1].properties.flag.example).toBe(true)
    expect(writtenSchema.items[1].properties.flag.examples).toBeUndefined()
  })

  test("logs an error when writing a schema fails", () => {
    const schemas = {
      failing: {type: "string"}
    } as const

    const outputDir = "failing"
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("disk full")
    })

    writeSchemas(schemas, outputDir)

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const [message, err] = errorSpy.mock.calls[0]
    expect(message).toContain("failing.json")
    expect(err).toBeInstanceOf(Error)
  })
})

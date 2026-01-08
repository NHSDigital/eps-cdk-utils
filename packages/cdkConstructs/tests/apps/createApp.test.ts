/**
 * Tests for createApp function
 *
 * This test suite covers the createApp function which creates a CDK App with
 * standard configuration including:
 * - Environment variable validation
 * - App creation with proper aspects and tags
 * - Stack properties configuration
 * - Pull request detection and drift detection group modification
 * - Regional configuration
 *
 * Note: The getBooleanConfigFromEnvVar function uses Boolean() which converts
 * any non-empty string (including "false", "0", etc.) to true. Tests account
 * for this behavior.
 */
import {App, Aspects, Tags} from "aws-cdk-lib"
import {
  describe,
  test,
  beforeEach,
  afterEach,
  expect,
  vi
} from "vitest"
import {createApp} from "../../src/apps/createApp"
import {AwsSolutionsChecks} from "cdk-nag"

describe("createApp", () => {
  const originalEnv = process.env

  beforeEach(() => {
    // Reset environment before each test
    vi.resetModules()
    process.env = {...originalEnv}
  })

  afterEach(() => {
    // Restore environment after each test
    process.env = originalEnv
  })

  describe("when all environment variables are set", () => {
    beforeEach(() => {
      process.env.CDK_CONFIG_stackName = "test-stack"
      process.env.CDK_CONFIG_versionNumber = "1.2.3"
      process.env.CDK_CONFIG_commitId = "abc123def456"
      process.env.CDK_CONFIG_isPullRequest = "false"
    })

    test("creates an App with correct configuration", () => {
      const {app, props} = createApp("testApp", "testRepo", "test-drift-group")

      expect(app).toBeInstanceOf(App)
      expect(props.stackName).toBe("test-stack")
      expect(props.version).toBe("1.2.3")
      expect(props.commitId).toBe("abc123def456")
      expect(props.isPullRequest).toBe(false)
      expect(props.env?.region).toBe("eu-west-2")
    })

    test("uses custom region when provided", () => {
      const {props} = createApp("testApp", "testRepo", "test-drift-group", "us-east-1")

      expect(props.env?.region).toBe("us-east-1")
    })

    test("applies correct tags to the app", () => {
      // Spy on Tags.of(app).add to verify tag calls
      const addTagSpy = vi.fn()
      const tagsOfSpy = vi.spyOn(Tags, "of").mockReturnValue({
        add: addTagSpy
      } as unknown as Tags)

      const {app} = createApp("testApp", "testRepo", "test-drift-group")

      // Verify Tags.of was called with the app
      expect(tagsOfSpy).toHaveBeenCalledWith(app)

      // Verify all expected tags were added with correct values
      expect(addTagSpy).toHaveBeenCalledWith("version", "1.2.3")
      expect(addTagSpy).toHaveBeenCalledWith("commit", "abc123def456")
      expect(addTagSpy).toHaveBeenCalledWith("stackName", "test-stack")
      expect(addTagSpy).toHaveBeenCalledWith("cdkApp", "testApp")
      expect(addTagSpy).toHaveBeenCalledWith("repo", "testRepo")
      expect(addTagSpy).toHaveBeenCalledWith("cfnDriftDetectionGroup", "test-drift-group")

      // Verify exactly 6 tags were added
      expect(addTagSpy).toHaveBeenCalledTimes(6)

      // Restore the spy
      tagsOfSpy.mockRestore()
    })

    test("adds AwsSolutionsChecks aspect", () => {
      const {app} = createApp("testApp", "testRepo", "test-drift-group")

      const aspects = Aspects.of(app).all
      expect(aspects).toContainEqual(new AwsSolutionsChecks({verbose: true}))
    })
  })

  describe("when isPullRequest is true", () => {
    beforeEach(() => {
      process.env.CDK_CONFIG_stackName = "pr-stack"
      process.env.CDK_CONFIG_versionNumber = "0.0.1-pr"
      process.env.CDK_CONFIG_commitId = "pr123"
      process.env.CDK_CONFIG_isPullRequest = "true"
    })

    test("sets isPullRequest to true in props", () => {
      const {props} = createApp("testApp", "testRepo", "test-drift-group")

      expect(props.isPullRequest).toBe(true)
    })

    test("modifies drift detection group with -pull-request suffix", () => {
      // Spy on Tags.of(app).add to verify tag calls
      const addTagSpy = vi.fn()
      const tagsOfSpy = vi.spyOn(Tags, "of").mockReturnValue({
        add: addTagSpy
      } as unknown as Tags)

      const {app} = createApp("testApp", "testRepo", "test-drift-group")

      // Verify Tags.of was called with the app
      expect(tagsOfSpy).toHaveBeenCalledWith(app)

      // Verify all expected tags were added with correct values
      expect(addTagSpy).toHaveBeenCalledWith("cfnDriftDetectionGroup", "test-drift-group-pull-request")
    })
  })

  describe("when environment variables are missing", () => {
    test("throws error when stackName is not set", () => {
      process.env.CDK_CONFIG_versionNumber = "1.0.0"
      process.env.CDK_CONFIG_commitId = "abc123"
      process.env.CDK_CONFIG_isPullRequest = "false"

      expect(() => {
        createApp("testApp", "testRepo", "test-drift-group")
      }).toThrow("Environment variable CDK_CONFIG_stackName is not set")
    })

    test("throws error when versionNumber is not set", () => {
      process.env.CDK_CONFIG_stackName = "test-stack"
      process.env.CDK_CONFIG_commitId = "abc123"
      process.env.CDK_CONFIG_isPullRequest = "false"

      expect(() => {
        createApp("testApp", "testRepo", "test-drift-group")
      }).toThrow("Environment variable CDK_CONFIG_versionNumber is not set")
    })

    test("throws error when commitId is not set", () => {
      process.env.CDK_CONFIG_stackName = "test-stack"
      process.env.CDK_CONFIG_versionNumber = "1.0.0"
      process.env.CDK_CONFIG_isPullRequest = "false"

      expect(() => {
        createApp("testApp", "testRepo", "test-drift-group")
      }).toThrow("Environment variable CDK_CONFIG_commitId is not set")
    })

    test("throws error when isPullRequest is not set", () => {
      process.env.CDK_CONFIG_stackName = "test-stack"
      process.env.CDK_CONFIG_versionNumber = "1.0.0"
      process.env.CDK_CONFIG_commitId = "abc123"

      expect(() => {
        createApp("testApp", "testRepo", "test-drift-group")
      }).toThrow("Environment variable CDK_CONFIG_isPullRequest is not set")
    })
  })
})

import path from "path"

process.env.CYBERSTRIKE_DB = ":memory:"
process.env.NPM_CONFIG_AUDIT = "false"
process.env.CYBERSTRIKE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.CYBERSTRIKE_DISABLE_MODELS_FETCH = "true"

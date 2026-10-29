// A node resolve hook for the bench. The plugin's hooks import one another without a file
// extension, which Claude Code's loader accepts and node's ESM loader does not, so when a relative
// import fails to resolve the hook tries it again with .ts and then .tsx.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.') || /\.[cm]?[jt]sx?$/.test(specifier)) throw error
    for (const extension of ['.ts', '.tsx']) {
      try {
        return await next(specifier + extension, context)
      } catch {}
    }
    throw error
  }
}

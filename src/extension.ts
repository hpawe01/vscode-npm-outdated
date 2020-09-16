import vscode from "vscode"
import { PackageJsonCodeActionProvider } from "./PackageJsonCodeActionProvider"
import { findOutdatedPackages } from "./diagnostics/findOutdatedPackages"
import { getPackageRanges } from "./diagnostics/getPackageRanges"
import { subscribeToDocument } from "./diagnostics/subscribeToDocument"
import { updatePackage } from "./packages/updatePackage"
import { DIAGNOSTIC_CODE } from "./utils/vars"

let diagnosticCollection: vscode.DiagnosticCollection

export function activate(ctx: vscode.ExtensionContext): void {
  diagnosticCollection = vscode.languages.createDiagnosticCollection("json")
  ctx.subscriptions.push(diagnosticCollection)

  subscribeToDocument(ctx, diagnosticCollection, async (doc) => {
    const results = await findOutdatedPackages(doc)
    const ranges = getPackageRanges(doc)

    const diagnostics = results.map((result) => {
      const diagnostic = new vscode.Diagnostic(
        ranges[result.name],
        `Newer version of ${result.name} is available (${result.latestVersion}).`,
        vscode.DiagnosticSeverity.Information
      )
      diagnostic.code = DIAGNOSTIC_CODE
      return diagnostic
    })

    // Clear any old diagnostics before creating the new diagnostics
    diagnosticCollection.clear()
    diagnosticCollection.set(doc.uri, diagnostics)
  })

  ctx.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      {
        language: "json",
        pattern: "**/package.json",
        scheme: "file",
      },
      new PackageJsonCodeActionProvider(),
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      }
    )
  )

  ctx.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.update, (name: string) => {
      updatePackage(name)
    })
  )
}

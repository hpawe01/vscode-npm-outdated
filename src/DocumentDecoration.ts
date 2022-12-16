import { prerelease } from "semver"

import {
  DecorationOptions,
  l10n,
  Position,
  Range,
  TextDocument,
  TextEditor,
  ThemableDecorationAttachmentRenderOptions,
  window,
} from "vscode"

import { PackageRelatedDiagnostic } from "./Diagnostic"
import { Icons, Margins, ThemeDark, ThemeLight } from "./Theme"
import { lazyCallback } from "./Utils"

class Message {
  constructor(
    public message: string,
    public styleDefault?: ThemableDecorationAttachmentRenderOptions,
    public styleDark?: ThemableDecorationAttachmentRenderOptions
  ) {}
}

// We need to create some decoration levels as needed.
// Each layer must have its own style implementation, so that the message order is respected.
// @see https://github.com/microsoft/vscode/issues/169051
export class DocumentDecorationManager {
  private static documents = new WeakMap<
    TextDocument,
    DocumentDecorationManager
  >()

  public layers: DocumentDecorationLayer[] = []

  public getLayer(layer: number): DocumentDecorationLayer {
    if (this.layers[layer] === undefined) {
      this.layers[layer] = new DocumentDecorationLayer()
    }

    return this.layers[layer]
  }

  flushLayers() {
    this.layers.forEach((layer) => (layer.lines = []))
  }

  // Returns the decoration layers of a document.
  // If the document has never been used, then instantiate and return.
  public static fromDocument(document: TextDocument) {
    if (!this.documents.has(document)) {
      this.documents.set(document, new DocumentDecorationManager())
    }

    return this.documents.get(document) as DocumentDecorationManager
  }

  // When the document is closed, then it unloads the layers defined for it.
  public static flushDocument(document: TextDocument) {
    DocumentDecorationManager.fromDocument(document).layers.forEach((layer) => {
      window.visibleTextEditors.forEach((editor) => {
        if (editor.document === document) {
          editor.setDecorations(layer.type, [])
        }
      })
    })

    this.documents.delete(document)
  }
}

class DocumentDecorationLayer {
  public lines: Record<number, DecorationOptions> = []

  public type = window.createTextEditorDecorationType({})
}

export class DocumentDecoration {
  private editors: TextEditor[]

  private flushed = false

  private render = lazyCallback(() => {
    DocumentDecorationManager.fromDocument(this.document).layers.forEach(
      (layer) => {
        this.editors.forEach((editor) =>
          editor.setDecorations(layer.type, Object.values(layer.lines).flat())
        )
      }
    )
  }, 100)

  constructor(private document: TextDocument) {
    this.editors = window.visibleTextEditors.filter(
      (editor) => editor.document === document
    )
  }

  private setLine(line: number, messages: Message[]) {
    const decorationManager = DocumentDecorationManager.fromDocument(
      this.document
    )

    if (!this.flushed) {
      this.flushed = true
      decorationManager.flushLayers()
    }

    messages.forEach((message, messageIndex) => {
      const decorationLayer = decorationManager.getLayer(messageIndex)

      decorationLayer.lines[line] = {
        range: new Range(new Position(line, 4096), new Position(line, 4096)),
        renderOptions: {
          after: {
            contentText: message.message,
            ...ThemeLight.DEFAULT,
            ...(messageIndex === 0
              ? Margins.MARGIN_INITIAL
              : Margins.MARGIN_THEN),
            ...message.styleDefault,
          },
          dark: {
            after: {
              ...ThemeDark.DEFAULT,
              ...message.styleDark,
            },
          },
        },
      }
    })

    this.render()
  }

  public clearLine(line: number): void {
    DocumentDecorationManager.fromDocument(this.document).layers.forEach(
      (decoration) => {
        delete decoration.lines[line]
      }
    )

    this.render()
  }

  public setCheckingMessage(line: number) {
    this.setLine(line, [new Message(Icons.CHECKING)])
  }

  public async setUpdateMessage(
    line: number,
    packageInfo: PackageRelatedDiagnostic
  ) {
    const versionLatest = await packageInfo.packageRelated.getVersionLatest()

    if (!versionLatest) {
      return
    }

    const packageVersionInstalled =
      await packageInfo.packageRelated.getVersionInstalled()

    // It informs that the version has not yet been installed,
    // but the user's version is in fact the last one available.
    if (
      !packageVersionInstalled &&
      (await packageInfo.packageRelated.isVersionMaxed())
    ) {
      return this.setLine(line, [
        new Message(
          Icons.PENDING,
          ThemeLight.ICON_AVAILABLE,
          ThemeDark.ICON_AVAILABLE
        ),
        new Message(l10n.t("Install pending")),
      ])
    }

    const updateDetails = [
      new Message(
        Icons.UPDATABLE,
        ThemeLight.ICON_UPDATABLE,
        ThemeDark.ICON_UPDATABLE
      ),
      new Message(
        packageVersionInstalled
          ? l10n.t("Update available:")
          : l10n.t("Latest version:"),
        ThemeLight.LABEL_UPDATABLE,
        ThemeDark.LABEL_UPDATABLE
      ),
      new Message(
        versionLatest,
        ThemeLight.LABEL_VERSION,
        ThemeDark.LABEL_VERSION
      ),
    ]

    if (!packageVersionInstalled) {
      // If the package has not yet been installed by the user, but defined in the dependencies.
      updateDetails.push(
        new Message(
          `(${l10n.t("install pending")})`,
          ThemeLight.LABEL_PENDING,
          ThemeDark.LABEL_PENDING
        )
      )
    } else if (
      await packageInfo.packageRelated.isVersionLatestAlreadyInstalled()
    ) {
      // If the latest version is already installed, it informs that only a user-defined version will be bumped.
      updateDetails.push(
        new Message(
          "(" + l10n.t("already installed, just formalization") + ")",
          ThemeLight.LABEL_FORMALIZATION,
          ThemeDark.LABEL_FORMALIZATION
        )
      )
    }

    // Identifies whether the suggested version is a major update.
    if (await packageInfo.packageRelated.isVersionMajorUpdate()) {
      updateDetails.push(
        new Message(
          "(" + l10n.t("attention: major update!") + ")",
          ThemeLight.LABEL_MAJOR,
          ThemeDark.LABEL_MAJOR
        )
      )
    }

    // Indicate that the suggested version is pre-release.
    // This will only happen if the user defined version is also pre-release.
    if (prerelease(versionLatest)) {
      updateDetails.push(
        new Message(
          "<" + l10n.t("pre-release") + ">",
          ThemeLight.LABEL_PRERELEASE,
          ThemeDark.LABEL_PRERELEASE
        )
      )
    }

    this.setLine(line, updateDetails)
  }
}

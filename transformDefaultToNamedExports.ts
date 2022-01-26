#!npx ts-node
import { ExportAssignment, Project, SourceFile, SyntaxKind } from 'ts-morph';

const project = new Project({
  tsConfigFilePath: 'tsconfig.json',
});

type DefaultExportChange = {
  filePath: string;
  namedExportName: string;
};

/**
 * ORIGINAL:
 * ```
 * const x = 1
 * export default x
 * ```
 *
 * TRANSFORMED:
 * ```
 * export const = 1
 * ```
 */
async function transformDefaultToNamedExportWhenSeparateDefinition(
  sourceFile: SourceFile,
  defaultExport: ExportAssignment,
  filesWithDefaultExportChanged: DefaultExportChange[]
) {
  const identifierOfDefaultExport = defaultExport.getChildrenOfKind(SyntaxKind.Identifier)[0];

  filesWithDefaultExportChanged.push({
    filePath: sourceFile.getFilePath(),
    namedExportName: identifierOfDefaultExport.getText(),
  });

  let definitionOfExportedObject = identifierOfDefaultExport.getDefinitionNodes()[0];

  if (definitionOfExportedObject === undefined) {
    throw Error("Couldn't find definition of exported object");
  }

  // For "const x = 1", we only have the VariableDeclaration "x = 1", so we get the VariableStatement "const x = 1"
  if (definitionOfExportedObject.getKind() === SyntaxKind.VariableDeclaration) {
    definitionOfExportedObject = definitionOfExportedObject.getParentWhile((parent, child) => {
      return child.getKind() !== SyntaxKind.VariableStatement;
    })!;
  }

  definitionOfExportedObject.replaceWithText(
    definitionOfExportedObject
      .getLeadingCommentRanges()
      .map((it) => it.getText() + '\n')
      .join('') +
      'export ' +
      definitionOfExportedObject.getText()
  );

  defaultExport.remove();

  await sourceFile.save();
}

/**
 * ORIGINAL:
 * ```
 * export default (a, b) => {}
 * ```
 *
 * TRANSFORMED:
 * ```
 * // in file logger.js or logger/index.js
 * export const logger = (a, b) => {}
 * ```
 */
async function transformDefaultToNamedExportWhenInlineDefinition(
  sourceFile: SourceFile,
  defaultExport: ExportAssignment,
  filesWithDefaultExportChanged: DefaultExportChange[]
) {
  const fileNameWithoutExtension = sourceFile.getBaseNameWithoutExtension();
  const nameForExportedValue =
    fileNameWithoutExtension !== 'index'
      ? fileNameWithoutExtension
      : sourceFile.getDirectory().getBaseName();

  const exportedValue = defaultExport.getStructure().expression.toString();

  filesWithDefaultExportChanged.push({
    filePath: sourceFile.getFilePath(),
    namedExportName: nameForExportedValue,
  });

  defaultExport.replaceWithText(
    defaultExport
      .getLeadingCommentRanges()
      .map((it) => it.getText() + '\n')
      .join('') +
      `export const ${nameForExportedValue} = ` +
      exportedValue
  );

  await sourceFile.save();
}

/**
 * ORIGINAL:
 * ```
 * import A from 'a'
 * import WrongName from 'b' // handles this edge case
 * const a = A()
 * const b = WrongName()
 * ```
 *
 * TRANSFORMED:
 * ```
 * import { A } from 'a'
 * import { B } from 'b'
 * const a = A()
 * const b = B()
 * ```
 */
function transformDefaultImportsToNamedImports(
  filesWithDefaultExportChanged: DefaultExportChange[]
) {
  project.getSourceFiles().forEach(async (sourceFile: SourceFile) => {
    const imports = sourceFile.getImportDeclarations();
    imports.forEach((import_) => {
      const filePath = import_.getModuleSpecifierSourceFile()?.getFilePath();
      const matchingFileWithDefaultExportChanged = filesWithDefaultExportChanged.find(
        (it) => it.filePath === filePath
      );
      if (matchingFileWithDefaultExportChanged !== undefined) {
        const defaultImport = import_.getDefaultImport();
        if (defaultImport !== undefined) {
          if (defaultImport.getText() !== matchingFileWithDefaultExportChanged.namedExportName) {
            import_.renameDefaultImport(matchingFileWithDefaultExportChanged.namedExportName);
          }

          import_.addNamedImport({
            name: matchingFileWithDefaultExportChanged.namedExportName,
          });
          import_.removeDefaultImport();
        }
      }
    });

    await sourceFile.save();
  });
}

async function run() {
  const filesWithDefaultExportChange: DefaultExportChange[] = [];

  await Promise.all(
    project.getSourceFiles().map(async (sourceFile: SourceFile) => {
      const defaultExport = sourceFile.getExportAssignment((exportAssignment) => {
        // I found a bug in the lib code due to which I have to leave this extra call here lol
        exportAssignment.getSymbol()?.getEscapedName();
        return exportAssignment.getSymbol()?.getEscapedName() === 'default';
      });

      if (defaultExport === undefined) {
        return;
      }

      // When export assignments have a separate declaration, there is a child node of Identifier kind
      const hasSeparateDeclaration = defaultExport
        .getChildren()
        .some((it) => it.getKind() === SyntaxKind.Identifier);

      if (hasSeparateDeclaration) {
        await transformDefaultToNamedExportWhenSeparateDefinition(
          sourceFile,
          defaultExport,
          filesWithDefaultExportChange
        );
      } else {
        await transformDefaultToNamedExportWhenInlineDefinition(
          sourceFile,
          defaultExport,
          filesWithDefaultExportChange
        );
      }
    })
  );

  transformDefaultImportsToNamedImports(filesWithDefaultExportChange);
}

run().then();

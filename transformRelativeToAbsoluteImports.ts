#!npx ts-node
import {Project} from 'ts-morph';

const project = new Project({
  tsConfigFilePath: 'tsconfig.json',
});

project.getSourceFiles().forEach(sourceFile => {
  const imports = sourceFile.getImportDeclarations();
  imports.forEach((import_) => {
    const filePath = import_.getModuleSpecifierSourceFile()?.getFilePath();
    const filePathSpecified = import_.getModuleSpecifierValue()

    if (filePath == null) {
      return
    }

    if (filePathSpecified.startsWith("./") || filePathSpecified.startsWith("../")) {
      console.log("---")
      console.log(filePathSpecified)
      console.log(filePath)

      // poor man's regex
      const startIndexOfPath = filePath.indexOf("src")
      let absolutePath = filePath.slice(startIndexOfPath)
      if (absolutePath.endsWith(".ts")) {
        absolutePath = absolutePath.slice(0, absolutePath.length - 3)
      }
      if (absolutePath.endsWith("/index")) {
        absolutePath = absolutePath.slice(0, absolutePath.length - 6)
      }

      import_.setModuleSpecifier(absolutePath)
    }
  })

  sourceFile.save().then()
})


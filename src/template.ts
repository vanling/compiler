import { compileScript, compileStyle, compileTemplate, parse } from '@vue/compiler-sfc'
import type { SFCScriptBlock, SFCStyleCompileResults } from '@vue/compiler-sfc'
import { createApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { blue, bold, lightGreen, red, white } from 'kolorist'
import type { Component } from 'vue'
import { pascalCase } from 'scule'
import { EBody, EButton, EColumn, EContainer, EFont, EHead, EHeading, EHr, EHtml, EImg, ELink, EMarkdown, EPreview, ERow, ESection, ETailwind, EText, VueEmailPlugin, cleanup } from 'vue-email'
import { importModule } from 'import-string'
import type { I18n } from 'vue-email'
import { createI18n } from 'vue-i18n'
import type { Options, RenderOptions, SourceOptions } from './types'

const components = {
  EBody,
  EHead,
  EHeading,
  EButton,
  EColumn,
  EContainer,
  EFont,
  EHr,
  EHtml,
  EImg,
  ELink,
  EMarkdown,
  EPreview,
  ERow,
  ESection,
  ETailwind,
  EText,
}

export async function templateRender(name: string, code: SourceOptions, options?: RenderOptions, config?: Options): Promise<string> {
  try {
    const verbose = config?.verbose || false
    const hasI18n = options?.i18n?.defaultLocale || config?.options?.i18n?.defaultLocale || options?.i18n?.translations || config?.options?.i18n?.translations

    const props = options?.props || config?.options?.props
    name = correctName(name)
    const component = await loadComponent(name, code.source, verbose)

    if (verbose)
      console.warn(`${lightGreen('💌')} ${bold(blue('Generating output'))}`)

    if (!component)
      throw new Error(`Component ${name} not found`)

    const app = createApp(component, props)
    app.use(VueEmailPlugin, config?.options)
    app.config.performance = true

    if (code.components && code.components.length > 0) {
      for (const emailComponent of code.components) {
        const componentName = correctName(emailComponent.name)
        const componentCode = await loadComponent(componentName, emailComponent.source, verbose)
        if (componentCode) {
          app.component(componentName, {
            ...componentCode,
            components,
          })
        }
      }
    }

    if (hasI18n) {
      const i18nOptions: I18n = {
        defaultLocale: options?.i18n?.defaultLocale || config?.options?.i18n?.defaultLocale || 'en',
        translations: options?.i18n?.translations || config?.options?.i18n?.translations,
      }

      const locale = i18nOptions.defaultLocale
      if (locale) {
        if (verbose)
          console.warn(`${lightGreen('🌎')} ${bold(blue('Injecting translations'))}`)

        try {
          const i18n = createI18n({
            locale,
            fallbackLocale: i18nOptions.defaultLocale,
            messages: i18nOptions.translations,
            silentFallbackWarn: !verbose,
            silentTranslationWarn: !verbose,
            warnHtmlInMessage: 'off',
          })

          app.use(i18n)
        }
        catch (error) {
          throw new Error(`${lightGreen('❌')} ${bold(red(`Missing vue-i18n dependency`))} ${white('please install it using: ')} ${bold(white('npm i vue-i18n@9'))}`)
        }
      }
    }

    if (verbose)
      console.warn(`${lightGreen('🎉')} ${bold(blue('Rendering template'))} ${bold(lightGreen(name))}`)

    const markup = await renderToString(app)
    const doctype = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">'
    const doc = `${doctype}${cleanup(markup)}`

    return doc
  }
  catch (error) {
    console.error('Error rendering template', error)
    return ''
  }
}

function correctName(name: string) {
  return pascalCase(name.replaceAll(':', '-').replace('.vue', ''))
}

async function loadComponent(name: string, source: string, verbose = false) {
  try {
    name = correctName(name)
    const compiledComponent = compile(name, source, verbose)
    const componentCode: Component = (await importModule(compiledComponent)).default

    return componentCode
  }
  catch (error) {
    console.error('Error loading component', error)
  }

  return null
}

function compile(filename: string, source: string, verbose = false) {
  let styles: SFCStyleCompileResults | null = null
  let script: SFCScriptBlock | null = null
  const scriptIdentifier = '_sfc_main'

  if (verbose)
    console.warn(`${lightGreen('🚧')} ${bold(blue('Compiling'))} ${bold(lightGreen(filename))} ${bold(blue('file'))}`)

  const { descriptor, errors } = parse(source, {
    filename,
  })

  if (errors.length)
    throw new Error(errors.join('\n'))

  if (descriptor.script || descriptor.scriptSetup) {
    script = compileScript(descriptor, {
      id: descriptor.filename,
      genDefaultAs: scriptIdentifier,
    })
  }

  if (descriptor.styles && descriptor.styles.length) {
    styles = compileStyle({
      id: descriptor.filename,
      filename,
      source: descriptor.styles[0].content,
      scoped: descriptor.styles.some(s => s.scoped),
    })
  }

  const template = compileTemplate({
    filename,
    id: descriptor.filename,
    source: descriptor.template!.content,
    compilerOptions: script
      ? {
          bindingMetadata: script.bindings,
        }
      : {},
  })

  const output = `
  ${template.code}\n
  ${script ? script.content : ''}
  ${styles ? `const styles = \`${styles.code}\`` : ''}
  ${script ? `${scriptIdentifier}.render = render` : `const ${scriptIdentifier} = { render }`}
  ${styles ? `${scriptIdentifier}.style = styles` : ''}
  ${scriptIdentifier}.__file = ${JSON.stringify(descriptor.filename)}
  ${script ? `export default ${scriptIdentifier}` : `export default { render }`}
  `

  return output
}

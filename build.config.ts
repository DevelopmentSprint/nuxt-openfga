import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    './src/module',
    './src/index',
    './src/types',
    {
      builder: 'mkdist',
      input: './src/runtime',
      outDir: './dist/runtime'
    }
  ],
  clean: true,
  declaration: true,
  externals: [
    '@nuxt/kit',
    '@nuxt/schema',
    '@openfga/sdk',
    'nitropack',
    'nitropack/runtime',
    'h3',
    '#imports',
    'vue',
    'defu'
  ]
})

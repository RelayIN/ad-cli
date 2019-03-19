const getopts = require('getopts')
const options = getopts(process.argv.slice(2), {})
const copyfiles = require('copyfiles')
const spawn = require('cross-spawn')
const del = require('del')
const { mkdir } = require('fs')
const { join } = require('path')
const { cyan, yellow, green } = require('kleur')

const PROJECT_DIR = process.cwd()
const PACKAGE_FILES = ['package.json', 'package-lock.json']

/**
 * Defaults if not defined inside `.adonisrc.json` file
 */
const DEFAULTS = {
  buildDir: 'build',
  nodemon: optionalRequire(join(PROJECT_DIR, 'nodemon.json')) || {
    ignore: ['*.spec.js'],
    delay: 0
  },
  metaFiles: ['.adonisrc.json', '.env']
}

/**
 * Optionally require a file. Missing file exceptions are not
 * raised
 */
function optionalRequire (filePath) {
  try {
    return require(filePath)
  } catch (error) {
    if (['ENOENT', 'MODULE_NOT_FOUND'].indexOf(error.code) === -1) {
      throw error
    }
  }
}

/**
 * Returns the artifacts for the build. They are read from `.adonisrc.json`
 * file or defaults are returned.
 */
function getBuildArtifacts () {
  const arts = optionalRequire(join(PROJECT_DIR, '.adonisrc.json')) || {}
  return Object.assign({}, DEFAULTS, arts)
}

/**
 * Copies meta files to the build directory. In case of
 * production build, `package` files are also copied.
 */
function copyMetaFiles (metaFiles, buildDir, prod) {
  return new Promise((resolve, reject) => {
    if (prod) {
      metaFiles = metaFiles.concat(PACKAGE_FILES)
    }

    console.log(`copying ${cyan(metaFiles.join(','))} to ${yellow(buildDir)}`)

    copyfiles(metaFiles.concat([buildDir]), {}, (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

/**
 * Install production only dependencies inside the compiled
 * project
 */
function npmInstall (buildDir, verbose) {
  console.log(`chdir ${cyan([buildDir])}`)
  process.chdir(buildDir)

  console.log(`installing ${cyan(['npm i --production'])}`)
  const result = spawn.sync('npm', ['i', '--production'], { stdio: 'inherit' })

  if (verbose) {
    console.log(result)
  }

  const backPath = buildDir.split('/').map(() => { return '..' }).join('/')
  console.log(`chdir ${cyan(backPath)}`)
  process.chdir(backPath)
}

/**
 */
function ensureBuildDir (buildDir) {
  console.log(`mkdir ${cyan(`[./${buildDir}]`)}`)

  return new Promise((resolve, reject) => {
    mkdir(buildDir, (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

/**
 * Runs `tsc` command line to compile all files
 */
function runTsc (buildDir, verbose) {
  console.log(`compiling ${cyan('[./node_modules/.bin/tsc -d false]')}`)

  const result = spawn.sync('./node_modules/.bin/tsc', ['-d', 'false', '--outDir', buildDir], { stdio: 'inherit' })
  if (verbose) {
    console.log(result)
  }
}

/**
 * Compiles typescript for production
 */
async function compileTypescript (clean, verbose) {
  console.log(cyan(PROJECT_DIR))

  const artifacts = getBuildArtifacts()

  await del([artifacts.buildDir])
  await ensureBuildDir(artifacts.buildDir)
  await copyMetaFiles(artifacts.metaFiles, artifacts.buildDir, true)
  runTsc(artifacts.buildDir, verbose)

  if (!clean) {
    npmInstall(artifacts.buildDir, verbose)
  }
}

/**
 * Watches typescript for development
 */
async function watchTypescript () {
  console.log(cyan(PROJECT_DIR))

  const TscWatchClient = require('tsc-watch/client')
  const nodemon = require('nodemon')

  const watch = new TscWatchClient()
  const artifacts = getBuildArtifacts()

  await del([artifacts.buildDir])
  await ensureBuildDir(artifacts.buildDir)
  await copyMetaFiles(artifacts.metaFiles, artifacts.buildDir, false)

  watch.on('first_success', () => {
    artifacts.nodemon.script = join(PROJECT_DIR, artifacts.nodemon.script)
    nodemon(artifacts.nodemon)

    nodemon
      .on('start', () => {
        console.log(green('Watching server for file changes'))
      })
      .on('quit', () => {
        watch.kill()
        process.exit()
      })
  })

  watch.start(
    '--project',
    '.',
    '--outDir',
    artifacts.buildDir,
    '--compiler',
    join(PROJECT_DIR, './node_modules/.bin/tsc')
  )
}

const command = options._[0]

if (!command) {
  console.log('')
  console.log(yellow('Commands'))
  console.log(`${cyan('dev')}        Start development server`)
  console.log(`${cyan('compile')}    Compile for production`)

  console.log('')
  console.log(yellow('Options'))
  console.log(`${cyan('--clean')}    Do not run \`npm install\` inside compiled output`)
  console.log('')
  return
}

if (command === 'dev') {
  watchTypescript().catch(console.error)
  return
}

if (command === 'build') {
  compileTypescript(options.clean, options.verbose).catch(console.error)
  return
}

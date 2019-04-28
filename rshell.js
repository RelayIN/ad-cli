const getopts = require('getopts')
const options = getopts(process.argv.slice(2), {})
const copyfiles = require('copyfiles')
const spawn = require('cross-spawn')
const del = require('del')
const { mkdir } = require('fs')
const { join, sep, isAbsolute } = require('path')
const { cyan, yellow, green, red } = require('kleur')

const PROJECT_DIR = process.cwd()
const PACKAGE_FILES = ['package.json', 'package-lock.json']

const KNEX_CONFIG_BLOCK = `
module.exports = {
  client: 'pg',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'virk',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'relay_service',
  },
}
`

const KNEX_DEPS_BLOCK = 'npm i knex pg'

/**
  The config for the migrations
*/
const MIGRATIONS_CONFIG = {
  directory: join(PROJECT_DIR, 'database', 'migrations'),
  extension: 'ts',
  tableName: 'adonis_schema',
}

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
function optionalRequire (filePath, onMissingModule) {
  try {
    return require(filePath)
  } catch (error) {
    if (['ENOENT', 'MODULE_NOT_FOUND'].indexOf(error.code) === -1) {
      throw error
    }

    if (typeof (onMissingModule) === 'function') {
      onMissingModule(error)
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
    '--noClear',
    '--project',
    '.',
    '--outDir',
    artifacts.buildDir,
    '--compiler',
    join(PROJECT_DIR, './node_modules/.bin/tsc')
  )
}

/**
 * Builds the knex connection for running migrations
 */
function loadDb () {
  require('ts-node').register()

  const connectionConfig = optionalRequire(
    join(PROJECT_DIR, 'database', 'migrations.js'),
    () => {
      console.log(red('Create `database/migrations.js` file and export connectionConfig from it'))
      console.log(KNEX_CONFIG_BLOCK)
      process.exit(1)
    }
  )

  connectionConfig.migrations = connectionConfig.migrations || {}
  connectionConfig.migrations.stub = join(__dirname, 'migration-stub.js')

  const knex = optionalRequire(
    join(PROJECT_DIR, 'node_modules', 'knex'),
    () => {
      console.log(red('Install knex and pg as dependencies'))
      console.log(KNEX_DEPS_BLOCK)
      process.exit(1)
    }
  )

  return knex(connectionConfig)
}

/**
 * Makes a new migration file
 */
function makeMigration (name) {
  if (!name) {
    console.log(red('Define migration file name'))
    process.exit(1)
    return
  }

  const db = loadDb()
  db.migrate.make(name, MIGRATIONS_CONFIG).then((filePath) => {
    console.log(green(`created: ${filePath.replace(`${PROJECT_DIR}${sep}`, '')}`))
    db.destroy()
    process.exit(0)
  })
  .catch((error) => {
    console.log(red('migration:make error'))
    console.log(error)
    db.destroy()
    process.exit(1)
  })
}

/**
 * Execute migrations
 */
function runMigrations () {
  const db = loadDb()

  db.migrate.latest(MIGRATIONS_CONFIG).then((response) => {
    if (!response[1].length) {
      console.log(cyan('Nothing to migrate'))
    } else {
      response[1].forEach((file) => {
        console.log(green(`migrated: ${file.replace(`${PROJECT_DIR}${sep}`, '')}`))
      })
    }

    db.destroy()
    process.exit(0)
  })
  .catch((error) => {
    console.log(red('migration:run error'))
    console.log(error)
    db.destroy()
    process.exit(1)
  })
}


/**
 * Rollback migrations to a given batch
 */
function rollbackMigrations (all) {
  const db = loadDb()

  db.migrate.rollback(MIGRATIONS_CONFIG, all).then((response) => {
    if (!response[1].length) {
      console.log(cyan('At latest batch'))
    } else {
      response[1].forEach((file) => {
        console.log(green(`rollback: ${file.replace(`${PROJECT_DIR}${sep}`, '')}`))
      })
    }

    db.destroy()
    process.exit(0)
  })
  .catch((error) => {
    console.log(red('migration:rollback error'))
    console.log(error)
    db.destroy()
    process.exit(1)
  })
}

/**
 * Creates a new project by cloning the boilerplate
 * from github
 */
function newProject (projectDir) {
  if (!projectDir) {
    console.log(red('Define project path'))
    process.exit(1)
    return
  }

  projectDir = isAbsolute(projectDir) ? projectDir : join(process.cwd(), projectDir)

  console.log(cyan('bootstrapping new project'))
  spawn.sync('git', ['clone', 'git@github.com:RelayIN/node-boilerplate.git', projectDir], { stdio: 'inherit' })

  process.chdir(projectDir)
  console.log('npm install')
  const result = spawn.sync('npm', ['i'], { stdio: 'inherit' })

  console.log(cyan('  Running following commands to get started'))
  console.log(`    cd ${projectDir}`)
  console.log(`    rshell-macos dev`)
}

const command = options._[0]

if (!command) {
  console.log('')
  console.log(yellow('Commands'))
  console.log(`${cyan('new')}                   Create a new project`)
  console.log(`${cyan('dev')}                   Start development server`)
  console.log(`${cyan('compile')}               Compile for production`)
  console.log(`${cyan('migration:make')}        Create a new migration file`)
  console.log(`${cyan('migration:run')}         Run pending migrations`)
  console.log(`${cyan('migration:rollback')}    Rollback to previous batch. Pass --all to rollback to first batch`)

  console.log('')
  console.log(yellow('Options'))
  console.log(`${cyan('--clean')}               Do not run \`npm install\` inside compiled output`)
  console.log(`${cyan('--all')}                 Rollback to first batch`)
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

if (command === 'migration:make') {
  makeMigration(options._[1])
  return
}

if (command === 'migration:run') {
  runMigrations()
  return
}

if (command === 'migration:rollback') {
  rollbackMigrations(options.all)
  return
}

if (command === 'new') {
  newProject(options._[1])
  return
}

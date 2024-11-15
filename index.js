const simpleGit = require('simple-git');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const { resolve } = require('path');

const PROJECT_PATH = '/Users/lt/Documents/level-travel/lt-frontend';
const DEVELOP_BRANCH = 'develop';

const git = simpleGit({
  baseDir: PROJECT_PATH,
  binary: 'git',
  maxConcurrentProcesses: 1,
  trimmed: false,
});

// запуск пре-релизного CI
const preReleaseCI = async () => {
  // Сохраняем текущую рабочую директорию
  const originalCwd = process.cwd();
  // Меняем рабочую директорию на целевой проект
  process.chdir(PROJECT_PATH);
  return new Promise((resolve, reject) => {
    exec('sh ./script/pre-release.sh', async (err, stdout, stderr) => {
      console.log(stderr);
      if (err) {
        process.chdir(originalCwd);
        reject(stderr);
        return;
      }

      process.chdir(originalCwd);
      resolve(stdout);
    });
  });
}

// функция которая переключается на основе которой будет создан релиз и обновляем ее
const switchBaseBranchRelease = async (baseBranch) => {
  console.group(`Переключаемся на ветку ${baseBranch} и обновляем ее`);
  await git.checkout(baseBranch);
  console.info(`Переключились на ветку ${baseBranch}`);
  await git.pull('origin', baseBranch);
  console.log(`Получили последние изменения из ветки ${baseBranch}`);
  console.groupEnd();
}

// получаем следующую версию релиза и предварительный CHANGELOG
const releaseVersionAndReleaseText = async () => {
  console.group('Получаем следующую версию релиза и предварительный CHANGELOG');
  // Сохраняем текущую рабочую директорию
  const originalCwd = process.cwd();
  // Меняем рабочую директорию на целевой проект
  process.chdir(PROJECT_PATH);

  return new Promise((resolve, reject) => {
    // Запускаем standard-version с dry-run и захватываем вывод
    exec('npx standard-version --dry-run', async (err, stdout, stderr) => {
      if (err) {
        // Восстанавливаем оригинальную рабочую директорию
        process.chdir(originalCwd);
        console.groupEnd();
        reject('Error running standard-version:', err);
      }

      // Ищем строку с новой версией
      const versionMatch = stdout.match(/tagging release v(\d+\.\d+\.\d+)/);

      if (versionMatch) {
        const newVersion = versionMatch[1];
        console.info(`Новая версия релиза: ${newVersion}`);

        // Формируем ветку release/номер нового релиза
        const releaseBranch = `release/${newVersion}`;

        // Восстанавливаем оригинальную рабочую директорию
        process.chdir(originalCwd);
        console.groupEnd();
        resolve({ newVersion, releaseBranch, releaseText: stdout });
      } else {
        // Восстанавливаем оригинальную рабочую директорию
        process.chdir(originalCwd);
        console.groupEnd();
        reject('Не удалось определить новую версию');
      }
    });
  });
}

// создаем и пушим ветку релиза в удаленный репозиторий
const createReleaseBranch = async (releaseBranch) => {
  console.group(`Создаем ветку релиза ${releaseBranch}`);

  // проверяем существует ли ветка
  const branches = await git.branch();
  if (branches.all.includes(releaseBranch)) {
    throw new Error('Ветка уже существует');
  }

  await git.checkoutLocalBranch(releaseBranch);
  console.log(`Ветка ${releaseBranch} создана и переключена`);

  // Пушим новую ветку в репозиторий
  await git.push('origin', releaseBranch);
  console.log(`Ветка ${releaseBranch} отправлена на сервер`);

  console.groupEnd();
}

const writeChangelogToСlipboard = async (releaseText) => {
  console.group('Записываем предварительный CHANGELOG в файл');

  const proc = await spawn('pbcopy');
  await proc.stdin.write(releaseText);
  await proc.stdin.end();

  console.groupEnd();
}

// функция для отдачи релиза в тестирование
const getReleaseToTest = async () => {
  await preReleaseCI();

  await switchBaseBranchRelease(DEVELOP_BRANCH);

  const { releaseBranch, releaseText } = await releaseVersionAndReleaseText();

  await createReleaseBranch(releaseBranch);

  await writeChangelogToСlipboard(releaseText);
}

const createRelease = async() => {
  // Сохраняем текущую рабочую директорию
  const originalCwd = process.cwd();
  // Меняем рабочую директорию на целевой проект
  process.chdir(PROJECT_PATH);

  return new Promise((resolve, reject) => {
    // Запускаем standard-version с dry-run и захватываем вывод
    exec('HUSKY=0 npx standard-version', async (err, stdout, stderr) => {
      if (err) {
        // Восстанавливаем оригинальную рабочую директорию
        process.chdir(originalCwd);
        reject('Error running standard-version:', err);
      }

      const versionMatch = stdout.match(/tagging release v(\d+\.\d+\.\d+)/);

      if (!versionMatch) reject('Не удалось определить новую версию');

      // узнать текущую ветку
      ///const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);

      //if (!currentBranch.match(versionMatch)) reject('Эта ветка не этого релиза');

      process.chdir(originalCwd);
      resolve();
    });
  });
}

const pushRelease = async (releaseBranch) => {
  // Сохраняем текущую рабочую директорию
  const originalCwd = process.cwd();
  // Меняем рабочую директорию на целевой проект
  process.chdir(PROJECT_PATH);

  git.push('origin', releaseBranch);

  git.pushTags('origin');

  process.chdir(originalCwd);
}

// функция для отдачи релиза в продакшн
const getReleaseForProduction = async () => {
  await preReleaseCI();

  await switchBaseBranchRelease(DEVELOP_BRANCH);

  const { releaseBranch } = await releaseVersionAndReleaseText();

  await switchBaseBranchRelease(releaseBranch);

  await createRelease();

  await pushRelease(releaseBranch);
}

const deleteReleaseBranch = async () => {
  await switchBaseBranchRelease(DEVELOP_BRANCH);

  const { releaseBranch } = await releaseVersionAndReleaseText();

  // Проверяем существует ли ветка
  const branches = await git.branch();
  if (branches.all.includes(releaseBranch)) {
    console.log(`Ветка ${releaseBranch} уже существует`);
    // Удаляем ветку
    await git.deleteLocalBranch(releaseBranch);
    console.log(`Удалили ветку ${releaseBranch}`);
    // Удаляем из удаленного репозитория
    await git.push(['origin', '--D', releaseBranch]);
    console.log(`Удалили ветку ${releaseBranch} из удаленного репозитория`);
  }
}

const start = async () => {
  console.log(process.argv[2]);
  if (process.argv[2] && process.argv[2] === '-test') {
    await getReleaseToTest();
  }

  if (process.argv[2] && process.argv[2] === '-prod') {
    await getReleaseForProduction();
  }

  if (process.argv[2] && process.argv[2] === '-delete-test') {
    await deleteReleaseBranch();
  }
};


start();


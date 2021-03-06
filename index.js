const puppeteer = require('puppeteer-core');
const os = require("os");
const path = require("path");
const fs = require('fs/promises');
const ora = require('ora');
const { ArgumentParser } = require('argparse');
const { version } = require('./package.json');
const Mustache = require('mustache');

async function getUrlList(filePath = './data.txt') {
  // read contents of the file
  const data = await fs.readFile(filePath, {
    encoding: 'UTF-8'
  });
  // split the contents by new line
  let lines = data.split(/\r?\n/);
  // trim
  lines = lines.map(line => {
    line = line.trim();
    if (!line.startsWith('http://') && !line.startsWith('https://')) {
      line = `http://${line}`;
    }
    return line;
  });
  return lines;
}

async function writeFile(filePath = './output.txt', content) {
  await fs.writeFile(filePath, content, {
    encoding: 'UTF-8'
  });
}

function transformShortenDomain(domains) {
  const shortenCnDomainRegex = /^(?:.*\.)?(\w+(?:\.com|\.edu)\.cn)$/
  const shortenDomainRegex = /^(?:.*\.)?(\w+\.\w+)$/
  const ipDomainRegex = /^(\d+\.\d+\.\d+\.\d+)$/
  let match = null;
  let results = domains.map(domain => {
    match = ipDomainRegex.exec(domain);
    if (match != null) {
      return match[1];
    }
    match = shortenCnDomainRegex.exec(domain);
    if (match != null) {
      return match[1];
    }
    match = shortenDomainRegex.exec(domain);
    if (match != null) {
      return match[1];
    }
    return null;
  });
  results = [...new Set(results)];
  results = results.filter(item => item != null);
  results.sort();
  return results;
}

function getChromePath() {
  let browserPath;

  if (os.type() === "Windows_NT") {
    // Chrome is usually installed as a 32-bit application, on 64-bit systems it will have a different installation path.
    const programFiles =
      os.arch() === "x64"
        ? process.env["PROGRAMFILES(X86)"]
        : process.env.PROGRAMFILES;
    browserPath = path.join(
      programFiles,
      "Google/Chrome/Application/chrome.exe"
    );
  } else if (os.type() === "Linux") {
    browserPath = "/usr/bin/google-chrome";
  } else if (os.type() === "Darwin") {
    browserPath =
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }

  if (browserPath && browserPath.length > 0) {
    return path.normalize(browserPath);
  }

  throw new TypeError(`Cannot run action. ${os.type} is not supported.`);
}

async function oraProcess(title, cb) {
  const spinner = ora({ text: `${title} starting...`, isEnabled: true }).start();
  try {
    await cb();
    spinner.succeed(`${title} finished...`);
    return true;
  } catch (error) {
    spinner.fail(`${title} failed...`);
    return false;
  }
}

const parser = new ArgumentParser({
  description: 'ynu-domain-crawler'
});

parser.add_argument('-v', '--version', { action: 'version', version });
parser.add_argument('-i', '--input', { help: 'input data filePath', default: './data.txt' });

(async () => {
  const argparseResult = parser.parse_args();
  const filePath = argparseResult.input;
  if (!require('fs').existsSync(filePath)) {
    return console.error('input file not exists!');
  }
  const { name: fileName } = path.parse(filePath);
  let spinner = ora({ text: 'Processing...', isEnabled: true }).stopAndPersist();
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: getChromePath(),
  });
  const [page] = await browser.pages();
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    results.push(url.hostname);
    request.continue();
  });
  page.on('error', err => {
    console.log('\nError occurred: ', err);
  });
  page.on('pageerror', pageerr => {
    console.log('\nPageerror occurred: ', pageerr);
  })
  const urls = await getUrlList(filePath);
  let results = [];
  const totalUrls = urls.length;
  for (let i = 0; i < totalUrls; i++) {
    const url = urls[i];
    spinner = ora({ text: `(${i + 1}/${totalUrls}) Processing ${url}`, isEnabled: true }).start();
    try {
      // add the initial hostname even browse failed
      results.push(new URL(url).hostname);
      await page.goto(url, {
        waitUntil: 'networkidle0',
      });
      spinner.succeed(`(${i + 1}/${totalUrls}) Processed ${url}`);
    } catch (e) {
      console.log(`\nError occurred on open page ${url} `, e);
      spinner.fail(`(${i + 1}/${totalUrls}) Processed failed for ${url}`);
    }
  }
  await browser.close();
  spinner = ora({ text: `got ${results.length} domains`, isEnabled: true }).stopAndPersist();
  // remove duplicates and sort the results
  results = [...new Set(results)];
  results.sort();
  spinner = ora({ text: `got unique ${results.length} domains`, isEnabled: true }).stopAndPersist();
  await oraProcess(`write output-${fileName}-all.txt`, async () => await writeFile(`output-${fileName}-all.txt`, results.join('\n')))
  results = transformShortenDomain(results);
  spinner = ora({ text: `got unique sorted unique ${results.length} domains`, isEnabled: true }).stopAndPersist();
  await oraProcess(`write output-${fileName}-shorten.txt`, async () => await writeFile(`output-${fileName}-shorten.txt`, results.join('\n')));
  await oraProcess(`write output-${fileName}-shorten-squid.txt`, async () => await writeFile(`output-${fileName}-shorten-squid.txt`, results.map(item => `.${item}`).join('\n')));
  // render the proxy.pac from proxy.pac.mustache
  const template = await fs.readFile('./proxy.pac.mustache', { encoding: 'UTF-8' });
  await oraProcess(`write output-${fileName}-proxy-pac.txt`, async () => await writeFile(`output-${fileName}-proxy-pac.txt`, Mustache.render(template, { domains: results })));
})();
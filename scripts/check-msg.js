/**
 * Script to check that no messages are used in the code are undefined,
 * and that all defined messages are actually used. Also flags use of parameters
 * for messages with no parameters and vice-versa.
 *
 * Run as:
 * 	node check-msg.js
 * Or via grunt as
 * 	grunt exec:check_msg
 */

const fs = require('fs/promises');
const path = require('path');
const { mwn } = require('mwn');

const repoRoot = __dirname + '/../';

async function readFile(path) {
	return (await fs.readFile(path)).toString();
}

async function getCodes(dir) {
	const fileList = await fs.readdir(dir);
	let code = '';
	for await (let file of fileList) {
		if (!file.endsWith('.ts')) {
			continue;
		}
		code += await readFile(path.join(dir, file));
	}
	return code;
}

async function parseMwMessages() {
	let code = await readFile(repoRoot + 'src/mw-messages.ts');
	return eval(code.slice(code.indexOf('[')));
}

let exitCode = 0;

function error(note) {
	exitCode = 1;
	console.error('[E] ' + note);
}

(async () => {
	const messages = JSON.parse(await readFile(repoRoot + 'i18n/en.json'));
	delete messages['@metadata'];
	const mwMessageNames = await parseMwMessages();
	const bot = new mwn({ apiUrl: 'https://en.wikipedia.org/w/api.php' });
	const mwMessages = {};
	for (let i = 0; i < mwMessageNames.length; i += 50) {
		Object.assign(mwMessages, await bot.getMessages(mwMessageNames.slice(i, i + 50)));
	}
	const messageUsages = Object.fromEntries(Object.keys(messages).map((m) => [m, 0]));
	const mwMessageUsages = Object.fromEntries(mwMessageNames.map((m) => [m, 0]));

	const code = (await getCodes(repoRoot + 'src')) + (await getCodes(repoRoot + 'src/modules'));

	// this regex relies on the fact that all msg() usages are simple.
	// use of any logic for coming up with message key inside msg( ... ) parens
	// will cause problems
	const rgx = /msg\((['"])(.*?)\1(,.*?)?\)/g;

	for (let match of code.matchAll(rgx)) {
		const msgKey = match[2];

		if (messageUsages[msgKey] !== undefined) {
			messageUsages[msgKey] += 1;
		} else if (mwMessageUsages[msgKey] !== undefined) {
			mwMessageUsages[msgKey] += 1;
		} else {
			error(`${match[0]}: no such message is defined`);
			continue;
		}

		const msgVal = messages[msgKey] ?? mwMessages[msgKey];
		const replacements = msgVal.match(/\$\d+/g) || [];
		const numParamsMsg = Math.max(...replacements.map((m) => parseInt(m.slice(1))), 0);
		const paramsUsed = match[3];
		if (numParamsMsg > 0 && !paramsUsed) {
			error(`${match[0]}: no parameters used here but message has parameters: "${msgVal}"`);
			continue;
		}
		if (paramsUsed && numParamsMsg === 0) {
			error(`${match[0]}: parameters used here but not in message: "${msgVal}"`);
		}
		// Still possible that number of parameters can be mis-matched, but we can't really check for that
		// without a full-fledged JS parser
	}

	for (let [msgKey, count] of Object.entries(messageUsages)) {
		if (count === 0) {
			console.warn(`[W] message ${msgKey} is possibly unused`);
		}
	}
	for (let [msgKey, count] of Object.entries(mwMessageUsages)) {
		if (count === 0) {
			console.warn(`[W] MW message ${msgKey} is possibly unused`);
		}
	}

	process.exit(exitCode);
})();

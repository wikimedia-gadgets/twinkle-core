import './test_base';

import { msg, addMessages, initMessaging, loadTwinkleCoreMessages, banana } from '../src/messenger';
import { initialiseMwApi } from '../src/Api';

describe('messenger', () => {
	beforeAll(async () => {
		initialiseMwApi();
		await initMessaging();
		// check if mediawiki messages were fetched
		expect(msg('word-separator')).toBe(' ');
	});

	test('loadTwinkleCoreMessages', async () => {
		await loadTwinkleCoreMessages('fr'); // slow
		banana.setLocale('fr');
		expect(msg('info')).toBe('Infos'); // verify message is loaded
		const cachedObject = mw.storage.getObject('tw-i18n-fr');
		expect(cachedObject).not.toBeNull();
		expect(cachedObject['fr']['info']).toBe('Infos');

		// call it again, 2nd call should be much quicker as data is retrieved from localStorage
		let startTime = new Date().getTime();
		await loadTwinkleCoreMessages('fr');
		let endTime = new Date().getTime();
		expect(endTime - startTime).toBeLessThan(20); // shouldn't take more than 20 ms
	}, 4000);

	test('addMessages and msg', () => {
		addMessages({
			'test-msg-1': 'Test message 1',
		});
		expect(msg('test-msg-1')).toEqual('Test message 1');
		addMessages({
			'test-msg-2': 'Test message 2',
		});
		expect(msg('test-msg-1')).toEqual('Test message 1');
		expect(msg('test-msg-2')).toEqual('Test message 2');
	});

	test('i18n parser plugins', () => {
		expect(msg('{{date:$1|D MMM YYYY}}', '4 December 2021')).toEqual('4 Dec 2021');
		expect(msg('{{date:$1|D MMM YYYY}}', new Date('4 December 2021'))).toEqual('4 Dec 2021');

		expect(msg('{{int:test-msg-1}}')).toEqual('Test message 1');

		expect(msg('{{ns:3}}')).toEqual('User talk');
		expect(msg('{{ns:special}}')).toEqual('Special');

		expect(msg('{{list:$1}}', ['1', '2', '3'])).toEqual('1, 2 and 3');

		expect(msg('{{ucfirst:hello}}')).toEqual('Hello');
		expect(msg('{{lcfirst:Hello}}')).toEqual('hello');
		expect(msg('{{lcfirst:hello}}')).toEqual('hello');
	});
});

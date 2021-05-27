import './test_base';

import { msg, addMessages, initMessaging } from '../src/messenger';
import { initialiseMwApi } from '../src/Api';

describe('messenger', () => {
	beforeAll(() => {
		initialiseMwApi();
		return initMessaging().then(() => {
			addMessages({
				'test-msg-1': 'Test message 1',
				'and': ' and',
				'word-separator': ' ',
				'comma-separator': ', ',
			});
		});
	});

	test('addMessages and msg', () => {
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

	// TODO: spy on mw.Api and add test for loadAdditionalMediaWikiMessages
});

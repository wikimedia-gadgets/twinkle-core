import './test_base';
import { mwApi, initialiseMwApi } from '../src/Api';
import { Twinkle } from '../src/twinkle';

describe('Api', () => {
	test('mwApi initialised correctly', () => {
		Twinkle.userAgent = 'twinkle-core-unit-testing';
		initialiseMwApi();
		// this tests that mwApi gets the updated userAgent rather than the default one.
		expect(mwApi.defaults.ajax.headers['Api-User-Agent']).toBe('twinkle-core-unit-testing');
		expect(mwApi.defaults.parameters.uselang).toBe('en');
	});
});

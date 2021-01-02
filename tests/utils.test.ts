import { makeArray, makeTemplate, obj_entries, obj_values, stripNs } from '../src/utils';

describe('utils', function() {

	test('makeArray', function() {
		expect(makeArray()).toEqual([]);
		expect(makeArray(undefined)).toEqual([]);
		expect(makeArray(null)).toEqual([]);
		expect(makeArray(4)).toEqual([4]);
		expect(makeArray([4, 5])).toEqual([4, 5]);
	});

	// Depends on MW mocking
	test.skip('stripNs', function() {
		expect(stripNs('Template:Foo')).toBe('Foo');
	});

	test('makeTemplate', () => {
		expect(makeTemplate('subst:afd', {
			pg: 'Linguistics',
			3: 'foo',
			1: 'bar',
			name: 'Lorem ipsum'
		})).toBe(`{{subst:afd|1=bar|3=foo|pg=Linguistics|name=Lorem ipsum}}`);
	});

	let testObject = {
		'string_field': 'string',
		'num_field': 4,
		'decimal_field': 4.53,
		'null_field': null,
		'undef_field': undefined,
		'true_field': true,
		'false_field': false,
		'arr_field': [4, 6]
	};

	test('obj_values', () => {
		expect(obj_values(testObject)).toEqual(Object.values(testObject));
	});
	test('obj_entries', () => {
		expect(obj_entries(testObject)).toEqual(Object.entries(testObject));
	});

});

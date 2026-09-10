const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const source = readFileSync(require('node:path').join(__dirname, '../script.js'), 'utf8');
function fixture(max, notes = []) {
    const context = vm.createContext({
        game: { maxNumber: max, history: notes.map(() => ({ type: 'question', asker: 0 })) },
        answerNotes: new Map(notes.map((note, index) => [index, note])),
        localPlayer: () => 0,
        document: { createElement: () => ({}) }
    });
    vm.runInContext(source.slice(source.indexOf('function createNumberLineScale('), source.indexOf('function renderTurn(')), context);
    return context;
}

test('below 23 expands 1–22 and compresses the upper end', () => {
    const scale = fixture(50, [{ direction: 'below', value: 23 }]).createNumberLineScale();
    assert.ok(scale.position(22) > 0.85);
    assert.equal(scale.right, 0.12);
    assert.match(scale.description, /1–22/);
});

test('all numbers round-trip through slider precision in narrow and extreme ranges', () => {
    for (const max of [2, 50, 1000]) {
        for (const notes of [[], [{ direction: 'below', value: 2 }],
            [{ direction: 'above', value: max - 1 }],
            [{ direction: 'above', value: 20 }, { direction: 'below', value: 22 }]]) {
            const scale = fixture(max, notes).createNumberLineScale();
            assert.equal(scale.position(1), 0);
            assert.equal(scale.position(max), 1);
            for (let value = 1; value <= max; value++) {
                assert.equal(scale.number(Math.round(scale.position(value) * 100000) / 100000), value);
                if (value > 1) assert.ok(scale.position(value) > scale.position(value - 1));
            }
        }
    }
});

test('conflicting notes fall back to an even scale; around notes do not impose bounds', () => {
    const context = fixture(50, [{ direction: 'above', value: 30 }, { direction: 'below', value: 20 }]);
    const scale = context.createNumberLineScale();
    assert.match(scale.description, /conflict/);
    assert.equal(scale.position(25), 24 / 49);
    assert.equal(fixture(50, [{ direction: 'around', value: 23 }]).createNumberLineScale().description, '');
});

test('note editors exclude their own bound and ignore opponents’ notes', () => {
    const context = fixture(50, [{ direction: 'below', value: 23 }]);
    assert.equal(context.createNumberLineScale(0).description, '');
    context.game.history[0].asker = 1;
    assert.equal(context.createNumberLineScale().description, '');
});

test('slider maps pointer input, steps by integers, and preserves selection on refresh', () => {
    const context = fixture(50, [{ direction: 'below', value: 23 }]);
    const listeners = {}, attributes = {};
    const input = {
        id: 'test', value: '12', style: {},
        setAttribute: (name, value) => { attributes[name] = value; },
        getAttribute: name => attributes[name],
        addEventListener: (name, callback) => { listeners[name] = callback; }
    };
    let selected = 12;
    const line = context.setupNumberLine(input, value => { selected = value; });
    const key = name => listeners.keydown({ key: name, preventDefault() {} });
    key('ArrowRight');
    assert.equal(selected, 13);
    key('End');
    assert.equal(selected, 50);
    key('ArrowRight');
    assert.equal(selected, 50);
    key('Home');
    assert.equal(selected, 1);
    input.value = '50000';
    listeners.input();
    assert.equal(selected, 13);
    context.answerNotes.set(0, { direction: 'above', value: 30 });
    line.refresh();
    assert.equal(attributes['aria-valuetext'], '13');
    line.setValue(42);
    key('ArrowLeft');
    assert.equal(selected, 41);
});

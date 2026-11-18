const { app } = require('electron')
const assert = require('node:assert/strict')
const native = require(process.env.PRISM_TEST_ADDON)

app.whenReady().then(async () => {
  const actions = []
  native.initRemote(action => actions.push(action))
  assert.equal(native.testToggle(), true)
  const deadline = Date.now() + 1500
  while (!actions.length && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.deepEqual(actions, ['toggle'])
  native.disposeRemote()
  assert.equal(native.testToggle(), false)
  app.exit()
}).catch(error => {
  console.error(error)
  app.exit(1)
})


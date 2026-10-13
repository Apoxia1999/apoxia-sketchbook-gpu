exec(open('verification/test-text-stress.py').read().split("command('/goog/cdp/execute'")[0])
exec(open('verification/test-text-interactions.py').read().split("cmd('/url'")[0])
cmd('/url',{'url':'http://localhost:4190'});time.sleep(3)
asyncjs('await initialBoardReady;return true;')
for theme in ['oled','indigo','paper']:
 js('document.querySelector("#themeChoices [data-theme='+theme+']").click();')
 assert js('return localStorage.getItem("referencias.theme")')==theme
 cmd('/refresh',{});time.sleep(2)
 asyncjs('await initialBoardReady;return true;')
 assert js('return document.documentElement.dataset.theme')==theme
js('localStorage.setItem("referencias.theme","lime");localStorage.removeItem("apoxia.paperTheme.v1");')
cmd('/refresh',{});time.sleep(2)
asyncjs('await initialBoardReady;return true;')
assert js('return document.documentElement.dataset.theme')=='lime'
print('Chosen themes survive reload; Paper migration preserves existing choice',flush=True)

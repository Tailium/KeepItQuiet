const fs = require("fs")
const files = fs.readdirSync("./translations/strings")
let translations = {}

// Loading translations
for(let file of files){
    translations[file.replace(".json", "")] = require("./strings/" + file)
}

module.exports = translations
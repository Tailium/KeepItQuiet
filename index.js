const dotenv = require('dotenv')
dotenv.config()

const { Telegram, InlineKeyboard } = require("puregram");
const translations = require("./translations")
const md5 = require("md5")
const sha1 = require("js-sha1")
const RC4 = require("simple-rc4")
const fetch = require("node-fetch")
const cheerio = require("cheerio");
const { randomBytes } = require('crypto');

let MESSAGES_DB = []
let MESSAGES_TEMP_HANDLER = []
let CACHED_TAGS = []
let CACHED_IDS = []

const telegram = Telegram.fromToken(process.env.TOKEN)

telegram.updates.on('message', async (ctx) => {
    const translation = translations[Object.keys(translations).includes(ctx.from.languageCode) ? ctx.from.languageCode : "en"]

    if(ctx.text == "/start"){
        return ctx.send(translation.introduction.replace("{firstName}", ctx.from.firstName))
    }
})

telegram.updates.on('inline_query', async(ctx) => {
    const translation = translations[Object.keys(translations).includes(ctx.from.languageCode) ? ctx.from.languageCode : "en"]
    let args = ctx.query.split(" ").filter(e => e != '')
    let message = translation.botMeeting
    let TEMP_ID = hash(Date.now())
    let userTag = []
    let messageTypen = false
    let readableAgain = true

    let query = [
        { 
            type: "article", 
            title: translation.tip.title, 
            input_message_content: { 
                message_text: translation.tip.message_text,
            }, 
            id: "_TIP", 
            description: translation.tip.description
        }
    ]

    if(!ctx.from.username) {
        if(!CACHED_IDS.find(e => e.id == ctx.from.id)) {
            CACHED_IDS.push({
                id: ctx.from.id,
                hash: randomBytes(4).toString("hex"),
                expires: Date.now() + 864e5
            })
        }

        const tagKeyboard = InlineKeyboard.keyboard([
            [
                InlineKeyboard.switchToCurrentChatButton({
                    text: translation.answer,
                    query: "*" + getUserHash(ctx.from.id)
                })
            ]
        ])

        query.push({
            type: "article", 
            title: translation.getTempId.title, 
            input_message_content: { 
                message_text: translation.getTempId.message_text.replaceAll("{temp_id}", getUserHash(ctx.from.id)).replaceAll("{exp_time}", declTime(getHashExporationTime(ctx.from.id) - Date.now(), translation.times).join(", ")).replaceAll("{secretName}", getUserNameByHash(getUserHash(ctx.from.id), translation.names.firstNames, translation.names.lastNames)),
            }, 
            reply_markup: tagKeyboard,
            id: "GET_A_TAG", 
            description: translation.getTempId.description
        })
    }

    const errorMessages = {
        0: translation.onlyOneArg,
        1: translation.incorrectTag,
        2: translation.sendingToBot,
        3: translation.moreThan10
    }

    if(args.length == 1){
        args[0] = args[0].replaceAll(/(@|!)/gi, "").toLowerCase().split(",")

        let errorMessage = args[0].length > 10 ? 3 : 0
            
        message = errorMessages[0]

        for(let tag of args[0]){
            if(tag.startsWith("*") && CACHED_IDS.find(e => e.hash == tag.replace("*", ""))){
                continue
            }

            errorMessage = await isTagValid(tag)

            message = errorMessages[errorMessage]
        }

        query = []
    } else if(args.length > 1) {
        readableAgain = !args[0].startsWith("!")
        userTag = args[0].replaceAll(/(@|!)/gi, "").toLowerCase().split(",")

        let errorMessage = userTag.length > 10 ? 3 : 0

        for(let tag of userTag){
            if(tag.startsWith("*") && CACHED_IDS.find(e => e.hash == tag.replace("*", ""))){
                continue
            }

            errorMessage = await isTagValid(tag)

            message = errorMessages[errorMessage]
        }

        args = args.slice(1).join(" ")

        if(errorMessage == 0){
            let messages = []
            for(let user of userTag){
                const CRYPTO = new RC4(Buffer.from(user.toLowerCase().replaceAll("*", "") + ctx.from.id))
                
                let cryptedMessage = Buffer.from(args)
                CRYPTO.update(cryptedMessage)

                messages.push({
                    message: cryptedMessage,
                    isHashed: user.startsWith("*")
                })
            }
            message = readableAgain ? translation.sent : translation.onetimeSent
            TEMP_ID = md5(userTag + ctx.from.id + Date.now()) 

            if(MESSAGES_TEMP_HANDLER.find(e => e.sender == ctx.from.id)){
                MESSAGES_TEMP_HANDLER = MESSAGES_TEMP_HANDLER.filter(e => e.sender != ctx.from.id)
            }

            MESSAGES_TEMP_HANDLER.push({
                id: TEMP_ID,
                messages,
                messageHash: hash(args),
                readableAgain: readableAgain,
                sender: ctx.from.id,
                readers: [],
                sent: Date.now(),
                expires: Date.now() + 864e5
            })

            messageTypen = true
        }else{
            message = errorMessages[errorMessage]
        }
        query = []
    }

    let keyboard = InlineKeyboard.keyboard([
        [
            InlineKeyboard.textButton({
                text: translation.read,
                payload: {
                    action: "read",
                    id: TEMP_ID
                }
            }),
            InlineKeyboard.textButton({
                text: translation.delete,
                payload: {
                    action: "delete",
                    id: TEMP_ID
                }
            }),
            InlineKeyboard.textButton({
                text: translation.whoReaded,
                payload: {
                    action: "check",
                    id: TEMP_ID
                }
            }),
        ],
        [
            InlineKeyboard.switchToCurrentChatButton({
                text: translation.toRecipients,
                query: (readableAgain ? "" : "!") + userTag.join(",") + " "
            }),
            InlineKeyboard.switchToCurrentChatButton({
                text: translation.toSender,
                query: (readableAgain ? "" : "!") + (ctx.from.username ? ctx.from.username : "*" + getUserHash(ctx.from.id)) + " "
            })
        ]
    ])

    query.push(
        { 
            type: "article", 
            title: message.title, 
            input_message_content: { 
                message_text: message.message_text.replace("{tags}", userTag.map(e => e.startsWith("*") ? `${getUserNameByHash(e.replace("*", ""), translation.names.firstNames, translation.names.lastNames)} (${e.replace("*", "")})` : `@${e}`).join(", ")).replace("{sender}", ctx.from.firstName),
            }, 
            reply_markup: messageTypen ? keyboard : undefined,
            id: TEMP_ID, 
            description: message.description
        }
    )

    await ctx.answerInlineQuery(query, {
        cache_time: 1
    })
})

telegram.updates.on('chosen_inline_result', async(ctx) => {
    const TEMP_MESSAGE = MESSAGES_TEMP_HANDLER.find(e => e.id === ctx.resultId)
    if(!TEMP_MESSAGE)return;

    MESSAGES_DB.push(TEMP_MESSAGE)
    MESSAGES_TEMP_HANDLER = MESSAGES_TEMP_HANDLER.filter(e => e != TEMP_MESSAGE)
})

telegram.updates.on('callback_query', async(ctx) => {
    const translation = translations[Object.keys(translations).includes(ctx.from.languageCode) ? ctx.from.languageCode : "en"]

    if(ctx.queryPayload.action == "answer"){
        return ctx.answerCallbackQuery({
            text: translation.answerText,
            show_alert: false
        })
    }

    const MESSAGE = localizeJSON(MESSAGES_DB).find(e => e.id == ctx.queryPayload.id)

    if(!MESSAGE)return ctx.answerCallbackQuery({
        text: translation.outdated,
        show_alert: false
    })
    
    if(ctx.queryPayload.action == "check"){
        if(ctx.from.id == MESSAGE.sender){
            return ctx.answerCallbackQuery({
                text: translation.whoRead.replace("{amountOfReaders}", MESSAGE.readers.length).replace("{maxAmountOfReaders}", MESSAGE.messages.length),
                show_alert: false
            })
        }else{
            return ctx.answerCallbackQuery({
                text: translation.onlyForSender,
                show_alert: false
            })
        }
    }

    let hashPositive = false,
        uncryptedMessage = "",
        messageHash = ""

    for(let message of MESSAGE.messages){
        const firstKeyPart = message.isHashed ? getUserHash(ctx.from.id) : ctx.from.username.toLowerCase()


        if(!firstKeyPart)continue

        const CRYPTO = new RC4(Buffer.from(firstKeyPart) + MESSAGE.sender)

        uncryptedMessage = Buffer.from(message.message)

        CRYPTO.update(uncryptedMessage)

        uncryptedMessage = uncryptedMessage.toString("utf8")

        if(MESSAGE.messageHash == hash(uncryptedMessage)){
            messageHash = hash(Buffer.from(message.message).toString("utf8"))
            hashPositive = true
            break;
        }
    }

    if(!hashPositive)return ctx.answerCallbackQuery({
        text: translation.notForYou,
        show_alert: false
    })

    if(ctx.queryPayload.action == "delete"){
        MESSAGES_DB = MESSAGES_DB.filter(e => e.id != MESSAGE.id)
    
        return ctx.answerCallbackQuery({
            text: translation.deleted,
            show_alert: false
        })
    }
    
    if(!MESSAGE.readableAgain){
        if(MESSAGE.readers.length == MESSAGE.messages.length){
            MESSAGES_DB = MESSAGES_DB.filter(e => e.id != MESSAGE.id)
        }

        if(MESSAGE.readers.includes(messageHash)){
            return ctx.answerCallbackQuery({
                text: translation.alreadyWasReaded,
                show_alert: false
            })
        }
    }

    if(ctx.queryPayload.action == "read" && !MESSAGE.readers.includes(messageHash)){
        MESSAGES_DB[MESSAGES_DB.indexOf(MESSAGES_DB.find(e => e.id == MESSAGE.id))].readers.push(messageHash)
        MESSAGE.readers.push(messageHash)
    }

    if(uncryptedMessage.length < 200){
        ctx.answerCallbackQuery({
            text: uncryptedMessage,
            show_alert: true
        })
    }else{
        telegram.api.sendMessage({
            text: uncryptedMessage,
            chat_id: ctx.from.id
        })
        .then(e => {
            return ctx.answerCallbackQuery({
                text: translation.checkPM,
                show_alert: false
            })
        }) 
        .catch(e => {
            return ctx.answerCallbackQuery({
                text: translation.pleaseAllowPM,
                show_alert: false
            })
        })
    }
})

telegram.updates.startPolling()
  .then(() => {
    console.log(`Keeping quiet at @${telegram.bot.username}!`)
    setInterval(clearBases, 10000)
  })
  .catch(console.error)

process.on("uncaughtException", e => {
    console.log(e)
});

process.on("unhandledRejection", e => {
    console.log(e)
});

function localizeJSON(object){
    return JSON.parse(JSON.stringify(object))
}

async function checkTag(tag){
    const result = (await (await fetch("https://t.me/" + tag)).text())
    const $ = cheerio.load(result)

    return $("div.tgme_page_extra")[0] ? $("div.tgme_page_extra")[0].children[0].data.trim().startsWith("@") : false
}

async function isTagValid(tag) {
    let errors = /^(?!_)([a-zA-Z0-9_]{5,32})(?<!_)$/.test(tag) ?
        (tag.endsWith("bot") ? 2 : 0) : 1

    if (errors != 0) {
        return errors
    } else {
        if (!CACHED_TAGS.find(e => e.tag == hash(tag))) {
            const checkForTag = await checkTag(tag)

            if (checkForTag) {
                CACHED_TAGS.push({
                    tag: hash(tag),
                    expire: Date.now() + 43200000
                })
                return 0
            } else {
                return 1
            }
        }else{
            return 0
        }
    }
}

function hash(text){
    return sha1(typeof text != "string" ? String(text) : text)
}

function getUserHash(id){
    return CACHED_IDS.find(e => e.id == id).hash
}

function getUserNameByHash(hash, names, lastnames){
    return `${names[parseInt(hash, 16) % names.length]} ${lastnames[parseInt(hash, 16) % lastnames.length]}`
}

function getHashExporationTime(id){
    return CACHED_IDS.find(e => e.id == id).expires
}

function declTime (unix, strings) {
    let milliseconds = unix % 1000,
        seconds = Math.floor((unix / 1000) % 60),
        minutes = Math.floor((unix / 60000) % 60),
        hours = Math.floor((unix / 3600000) % 24),
        days = Math.floor(unix / 86400000)
    
    let helperTimers = [ days, hours, minutes, seconds, milliseconds ]
    let output = []

    for (let i = 0; i < strings.length; i++) {
        output.push(declNumb(helperTimers[i], strings[i]))
    }

    return output.filter(e => !e.startsWith("0 "))
}

function declNumb (int, args, includeNumbers = true) {
    const firstNumber = int
    let number = Math.abs(int) % 100;
    let lastNum = number % 10;
    args = args
    
    if (typeof args !== "object") {
        throw new Error('Provided string must be an array!')
    }

    let output = args[2]
    if (number > 10 && number < 20) {
        output = args[2]
    } else if (lastNum > 1 && lastNum < 5) {
        output = args[1]
    } else if (lastNum === 1) {
        output = args[0]
    }

    return includeNumbers ? `${firstNumber} ${output}` : output
}

function clearBases(){
    // Tags
    CACHED_TAGS = CACHED_TAGS.filter(e => Date.now() < e.expire)
    MESSAGES_DB = MESSAGES_DB.filter(e => Date.now() < e.expires)
    CACHED_IDS = CACHED_IDS.filter(e => Date.now() < e.expires)
}
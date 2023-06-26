const dotenv = require('dotenv')
dotenv.config()

const { Telegram, InlineKeyboard } = require("puregram");
const translations = require("./translations")
const md5 = require("md5")
const RC4 = require("simple-rc4")
const fetch = require("node-fetch")
const cheerio = require("cheerio")

let MESSAGES_DB = []
let MESSAGES_TEMP_HANDLER = []
let CACHED_TAGS = []

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
    let TEMP_ID = md5(Date.now())
    let userTag = []
    let messageTypen = false

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

    const errorMessages = {
        0: translation.onlyOneArg,
        1: translation.incorrectTag,
        2: translation.sendingToBot,
        3: translation.moreThan10
    }

    if(args.length == 1){
        args[0] = args[0].replaceAll(/^(@|!)/gi, "").toLowerCase().split(",")

        let errors = args[0].length > 10 ? 3 : 0,
            errorReason = ""
            
        message = errorMessages[0]

        for(let tag of args[0]){
            errors = /^(?!_)([a-zA-Z0-9_]{5,32})(?<!_)$/.test(tag) ? 
            (tag.endsWith("bot") ? 2 : 0) : 1
            
            if(errors != 0){
                errorReason = tag
                message = errorMessages[errors]
                break;
            }else{
                if(!CACHED_TAGS.includes(tag)){
                    const checkForTag = await checkTag(tag)

                    if(checkForTag){
                        CACHED_TAGS.push(tag)
                    }else{
                        message = errorMessages[1]
                        break;
                    }
                }
            }
        }

        query = []
    } else if(args.length > 1) {
        let readableAgain = !args[0].startsWith("!")
        userTag = args[0].replaceAll(/^(@|!)/gi, "").toLowerCase().split(",")

        let errors = userTag.length > 10 ? 3 : 0,
            errorReason = ""

            for(let tag of args[0]){
                errors = /^(?!_)([a-zA-Z0-9_]{5,32})(?<!_)$/.test(tag) ? 
                (tag.endsWith("bot") ? 2 : 0) : 1
                
                if(errors != 0){
                    errorReason = tag
                    message = errorMessages[errors]
                    break;
                }else{
                    if(!CACHED_TAGS.includes(tag)){
                        const checkForTag = await checkTag(tag)
    
                        if(checkForTag){
                            CACHED_TAGS.push(tag)
                        }else{
                            message = errorMessages[1]
                            break;
                        }
                    }
                }
            }

        args = args.slice(1).join(" ")

        if(errors == 0){
            let messages = []
            for(let user of userTag){
                const CRYPTO = new RC4(Buffer.from(user.toLowerCase() + ctx.from.id))
                
                let cryptedMessage = Buffer.from(args)
                CRYPTO.update(cryptedMessage)

                messages.push(cryptedMessage)
            }
            message = translation.sent
            TEMP_ID = md5(userTag + ctx.from.id + Date.now()) 

            if(MESSAGES_TEMP_HANDLER.find(e => e.sender == ctx.from.id)){
                MESSAGES_TEMP_HANDLER = MESSAGES_TEMP_HANDLER.filter(e => e.sender != ctx.from.id)
            }

            MESSAGES_TEMP_HANDLER.push({
                id: TEMP_ID,
                messages,
                messageHash: md5(args),
                readableAgain: readableAgain,
                sender: ctx.from.id,
                wasReaded: false,
                sent: Date.now()
            })

            messageTypen = true
        }else{
            message = errorMessages[errors]
        }
        query = []
    }

    let keyboard = InlineKeyboard.keyboard([
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
        })
    ])

    /*if(userTag.length > 1){
        keyboard = keyboard.slice(0, -1) // because i'm lazy to do reading
    }*/

    query.push(
        { 
            type: "article", 
            title: message.title, 
            input_message_content: { 
                message_text: message.message_text.replace("{tags}", userTag.map(e => `@${e}`).join(", ")).replace("{sender}", ctx.from.firstName),
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
    const MESSAGE = localizeJSON(MESSAGES_DB).find(e => e.id == ctx.queryPayload.id)
    if(!MESSAGE)return ctx.answerCallbackQuery({
        text: translation.outdated,
        show_alert: true
    })

    if(Date.now()-MESSAGE.sent > 864e5) {
        MESSAGES_DB = MESSAGES_DB.filter(e => e.id != MESSAGE.id)

        return ctx.answerCallbackQuery({
            text: translation.outdated,
            show_alert: true
        })
    }

    let hashPositive = false,
        uncryptedMessage = ""

    for(let message of MESSAGE.messages){
        const CRYPTO = new RC4(Buffer.from(ctx.from.username.toLowerCase() + MESSAGE.sender))

        uncryptedMessage = Buffer.from(message)

        CRYPTO.update(uncryptedMessage)

        uncryptedMessage = uncryptedMessage.toString("utf8")

        if(MESSAGE.messageHash == md5(uncryptedMessage)){
            hashPositive = true
            break;
        }
    }
    
    if(!hashPositive)return ctx.answerCallbackQuery({
        text: translation.notForYou,
        show_alert: true
    })

    if(ctx.queryPayload.action == "delete"){
        MESSAGES_DB = MESSAGES_DB.filter(e => e.id != MESSAGE.id)
    
        return ctx.answerCallbackQuery({
            text: translation.deleted,
            show_alert: true
        })
    }

    if(!MESSAGE.readableAgain){
        MESSAGES_DB = MESSAGES_DB.filter(e => e.id != MESSAGE.id)
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
                show_alert: true
            })
        }) 
        .catch(e => {
            return ctx.answerCallbackQuery({
                text: translation.pleaseAllowPM,
                show_alert: true
            })
        })
        
    }

    
})

telegram.updates.startPolling()
  .then(() => console.log(`Keeping quiet at @${telegram.bot.username}!`))
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
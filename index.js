const dotenv = require('dotenv')
dotenv.config()

const { Telegram, InlineKeyboard } = require("puregram");
const translations = require("./translations")
const md5 = require("md5")
const RC4 = require("simple-rc4")

let MESSAGES_DB = []
let MESSAGES_TEMP_HANDLER = []

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
    let userTag = ""
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
        2: translation.sendingToBot
    }

    if(args.length == 1){
        args[0] = args[0].replaceAll(/^(@|!)/gi, "")
        let errors = /^(?!_)([a-zA-Z0-9_]{5,32})(?<!_)$/.test(args[0]) ? 0 : 
        (args[0].endsWith("bot") ? 2 : 1)

        message = errorMessages[errors]
        query = []
    } else if(args.length > 1) {
        let readableAgain = !args[0].startsWith("!")
        userTag = args[0].replaceAll(/^(@|!)/gi, "")

        let errors = /^(?!_)([a-zA-Z0-9_]{5,32})(?<!_)$/.test(userTag) ? 0 : 
        (userTag.endsWith("bot") ? 2 : 1)

        if(errors == 0){
            const CRYPTO = new RC4(Buffer.from(userTag + ctx.from.id))
            
            args = args.slice(1).join(" ")

            let cryptedMessage = Buffer.from(args)
            CRYPTO.update(cryptedMessage)

            message = translation.sent
            TEMP_ID = md5(userTag + ctx.from.id + Date.now()) 

            if(MESSAGES_TEMP_HANDLER.find(e => e.sender == ctx.from.id)){
                MESSAGES_TEMP_HANDLER = MESSAGES_TEMP_HANDLER.filter(e => e.sender != ctx.from.id)
            }

            MESSAGES_TEMP_HANDLER.push({
                id: TEMP_ID,
                message: cryptedMessage,
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

    const keyboard = InlineKeyboard.keyboard([
        InlineKeyboard.textButton({
            text: translation.read,
            payload: {
                id: TEMP_ID
            }
        })
    ])

    query.push(
        { 
            type: "article", 
            title: message.title, 
            input_message_content: { 
                message_text: message.message_text.replace("{tag}", userTag).replace("{sender}", ctx.from.firstName),
            }, 
            reply_markup: messageTypen ? keyboard : undefined,
            id: TEMP_ID, 
            description: message.description
        }
    )

    ctx.answerInlineQuery(query, {
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
    
    const CRYPTO = new RC4(Buffer.from(ctx.from.username + MESSAGE.sender))
    let uncryptedMessage = Buffer.from(MESSAGE.message)

    CRYPTO.update(uncryptedMessage)

    uncryptedMessage = uncryptedMessage.toString("utf8")

    if(MESSAGE.messageHash != md5(uncryptedMessage))return ctx.answerCallbackQuery({
        text: translation.notForYou,
        show_alert: true
    })

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
const Discord = require('discord.js');
const { Client, Attachment } = require('discord.js');
const client = new Discord.Client();
const dotenv = require('dotenv');

const request = require("request");
const fs = require("fs");

dotenv.load();

// Boot log
client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    client.user.setActivity('for your replays', { type: 'WATCHING' });

});  

// replay downloading function
let download = function(url, filename) {
    var r = request(url);

    r.on('response',  function (res) {
    res.pipe(fs.createWriteStream(filename));
        res.on('finish', function() {
            res.close();
            });
        res.on('error', function(err) {
            fs.unlink(filename);
            console.error(err);
        });
    });
}

// rrrocket.exe calling
var output = [];
let analyze = function(filename) {
    const execFile = require('child_process').execFile;
    execFile('rrrocket.exe', [filename], (error, stdout, stderr) => {
        if (error) {
            console.error('stderr', stderr);
            throw error;
        }
        console.log('\x1b[33m%s\x1b[0m JSON output parsed',filename);
        output = JSON.parse(stdout.replace(/("OnlineID":)(\d+)/gm, '$1"$2"'));
    });
};

// TODO: Parse JSON to embed for check
let confirm = function(output, filename, sender) {
    return new Promise( (resolve, reject) => {
        if(output["properties"]["TeamSize"] === 3){
            var team0 = [];
            var team1 = [];
            for(player of output["properties"]["PlayerStats"]){
                if(player["Team"] === 0){
                    team0.push(player);
                    console.log(player["Name"] + " with an ID of " + player["OnlineID"] + " added to team0");
                } else {
                    team1.push(player);
                    console.log(player["Name"] + " with an ID of " + player["OnlineID"] + " added to team1");
                }
            }

            if((team0.length === 3) && (team1.length === 3)){
                const embed = new Discord.RichEmbed()
                    .setAuthor("RLBCS Replay Analyzer", "https://cdn.discordapp.com/attachments/307474272337526794/514154788322017311/RLBCS.png")
                    .setColor("#00ff00")
                    .setDescription(`*${filename}* from <@${sender}>\nGame was played on __${output["properties"]["Date"]}__`)
                    .setFooter("React with 👍 if the data is correct!")
                    .setTimestamp()
                    .addField("Team 1", `${team0[0]["Name"]}\n${team0[1]["Name"]}\n${team0[2]["Name"]}`, true)
                    .addField("Match Score", `\n${output["properties"]["Team0Score"]} : ${output["properties"]["Team1Score"]}\n`, true)
                    .addField("Team 2", `${team1[0]["Name"]}\n${team1[1]["Name"]}\n${team1[2]["Name"]}`, true)
                resolve({embed});
            } else {
                reject("The game doesn't have 6 players! Please recheck if you have sent the right file.");
            }
        } else {
            reject("The replay is from a game that isn't 3v3");
        }
    });
}


// Parse JSON to Google Sheets
const GoogleSpreadsheet = require('google-spreadsheet');
const creds = require('./google/service-account.json');
const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID);

let upload = function(output) {
    return new Promise( (resolve) => {
        doc.useServiceAccountAuth(creds, function (err) {
            doc.addRow(6, { Name: output["properties"]["Id"] }, function(err) {
                if(err) {
                console.log(err);
                }
            });
            console.log("Added Match ID - " + output["properties"]["Id"]);
            var mvp = 0;
            for(player of output["properties"]["PlayerStats"]){
                if(player["Score"] > mvp){
                    mvp = player["Score"];
                }
            };
            console.log("The MVP is with score " + mvp);
            setTimeout(function(){
                for(player of output["properties"]["PlayerStats"]){
                    if(player["Score"] === mvp){
                        doc.addRow(process.env.SPREADSHEET_PAGE, { Name: player["Name"], OnlineID: player["OnlineID"], Score: player["Score"], Goals: player["Goals"], Assists: player["Assists"], Saves: player["Saves"], Shots: player["Shots"], MVP: "x" }, function(err) {
                            if(err) {
                            console.log(err);
                            }
                        });
                        console.log("Added MVP " + player["Name"] + " stats to spreadsheet");
                    } else {
                        doc.addRow(process.env.SPREADSHEET_PAGE, { Name: player["Name"], OnlineID: player["OnlineID"], Score: player["Score"], Goals: player["Goals"], Assists: player["Assists"], Saves: player["Saves"], Shots: player["Shots"] }, function(err) {
                            if(err) {
                            console.log(err);
                            }
                        });
                        console.log("Added " + player["Name"] + " stats to spreadsheet");
                    }
                }
                resolve(true);
            }, 2000);
        });
    });
}

var startCheck = true;
// reading Discord messages
client.on('message', message => {
    if(message.author.bot === false){
            sender = message.author.id;
            senderTag = message.author.tag;
            // checking if message has attachment
            if ((message.attachments.size > 0) && (message.mentions.users.first()) && (message.mentions.users.first() !== sender))  {
                if(startCheck === true){
                    startCheck = false;
                    message.channel.startTyping(); 
                    const mentioned = message.mentions.users.first();
                    const captain = message.guild.member(mentioned);
                    if (captain) {
                        filename = message.attachments.array()[0].filename
                        for (let item of message.attachments.array()) {
                            // checking if the attachment is .replay file
                            if ((/(.replay)$/i).test(item.filename)) { 
                                console.log('Found \x1b[33m%s\x1b[0m from %s', filename, senderTag);
                                // checking if file exists in parent folder
                                if(!fs.existsSync(filename)){ 
                                    download(message.attachments.first().url, filename);
                                    console.log('Downloading replay file \x1b[33m%s\x1b[0m from %s', filename, senderTag);
                                    // must have delay, to allow download function to finish
                                    setTimeout(function(){  
                                        analyze(filename);
                                        console.log('Ran rrrocket shell script');
                                        setTimeout(function(){  
                                            confirm(output, filename, sender).then(response => {
                                                message.channel.send(response).then(embedMessage => {
                                                    embedMessage.react('👍');
    
                                                        const filter = (reaction, user) => {
                                                            return ['👍'].includes(reaction.emoji.name) && user.id === sender || user.id === mentioned.id;
                                                        };
    
                                                        embedMessage.awaitReactions(filter, { max: 2, time: 30000, errors: ['time'] })
                                                        .then(collected => {
                                                            const reaction = collected.first();
                                                    
                                                            if (reaction.emoji.name === '👍') {
                                                                message.channel.send(`<@${sender}> and <@${mentioned.id}>, your input has been validated!`);
                                                                upload(output).then(response => {
                                                                    startCheck = response;
                                                                    setTimeout(function(){
                                                                    message.channel.bulkDelete(3)
                                                                        .then(messages => console.log('Confirmed replay file \x1b[33m%s\x1b[0m from %s', filename, senderTag))
                                                                        .catch(console.error);
                                                                    }, 5000);
                                                                });
                                                            }
                                                        })
                                                        .catch(collected => {
                                                            console.log(`No reaction from ${message.author.tag} or ${mentioned.tag}.`);
                                                            message.channel.send(`<@${sender}> and <@${mentioned.id}>, your input hasn't been validated! Please try again or contact RLBCS admin.`)
                                                            .then(msg => {
                                                                setTimeout(function(){ 
                                                                    message.channel.bulkDelete(3)
                                                                    .then(messages => console.log('Replay file \x1b[33m%s\x1b[0m from %s hasn\'t been confirmed', filename, senderTag))
                                                                    .catch(error => console.log(error));
                                                                }, 5000);
                                                            });
                                                            startCheck = true;
                                                    });
                                                })
                                            })
                                            .catch(error => {
                                                message.channel.send(error)
                                                .then(msg => {
                                                    msg.delete(5000)
                                                    message.delete(5000)
                                                });
                                                console.log("Invalid replay");
                                                startCheck = true;
                                            });
                                            message.channel.stopTyping(true);
                                        }, 1500);
                                    }, 5000);
                                } else { 
                                    console.log('\x1b[41mFile already exists.\x1b[0m Skipping...')
                                    message.reply('this file has been already uploaded!')
                                    .then(msg => {
                                        msg.delete(5000)
                                        message.delete(5000)
                                    });
                                    message.channel.stopTyping(true);
                                    startCheck = true;
                                }
                            } else {
                                message.reply('please upload only `.replay` files!')
                                .then(msg => {
                                    msg.delete(5000)
                                    message.delete(5000)
                                });
                                console.log("Uploaded file isn't .replay file");
                                message.channel.stopTyping(true);
                                startCheck = true;
                            }
                        }
                    } else {
                        message.reply('Mentioned user isn\'t in this server!')
                        .then(msg => {
                            msg.delete(5000)
                            message.delete(5000)
                        });
                        message.channel.stopTyping(true);
                        startCheck = true;
                    }
                } else {
                    message.reply("please wait while previous match data upload is finished!")
                    .then(msg => {
                        msg.delete(5000)
                        message.delete(5000)
                    });
                }
            } else {
                message.reply('Attachment or other team captain mention isn\'t found!')
                .then(msg => {
                    msg.delete(5000)
                    message.delete(5000)
                })
            }
    } else {
        return;
    }
})

client.login(process.env.CLIENT_KEY);
/*
 *
 *     A nodejs app for automatically sending ttv clips created using a command to a discord server
 *     Copyright (C) 2022  Oskar Manhart
 *
 *     This program is free software: you can redistribute it and/or modify
 *     it under the terms of the GNU General Public License as published by
 *     the Free Software Foundation, either version 3 of the License, or
 *     (at your option) any later version.
 *
 *     This program is distributed in the hope that it will be useful,
 *     but WITHOUT ANY WARRANTY; without even the implied warranty of
 *     MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *     GNU General Public License for more details.
 *
 *     You should have received a copy of the GNU General Public License
 *     along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *     If you have any questions, contact the Author at oskarmanhart@gmail.com.
 */

const express = require("express");
const https = require("https");
const dotenv = require("dotenv");

const APP_CLIENT_ID = process.env.APP_CLIENT_ID;
const APP_CLIENT_SECRET = process.env.APP_CLIENT_SECRET;
const APP_REFRESH_TOKEN = process.env.APP_REFRESH_TOKEN;
const DISCORD_WEBHOOK_ID = process.env.DISCORD_WEBHOOK_ID;
const DISCORD_WEBHOOK_TOKEN = process.env.DISCORD_WEBHOOK_TOKEN;
const CHANNEL_BROADCAST_ID = process.env.CHANNEL_BROADCAST_ID;
const DELAY_TO_POST_TO_DISCORD = 4 * 1000;
const POST_MESSAGE_TWITCH_CHAT = () => {
    return "A new clip was created in the Discord server! :)";
};
const POST_MESSAGE_DISCORD = ( username, clipURL ) => {
    return "A new clip was created" + (username ? " by @" + username : "") + "! :)\n\n" + clipURL;
};

// setting up dotenv
dotenv.config();

const ERROR_TYPE_TWITCH_CHANNEL_OFFLINE = 1;

async function getRefreshedAccessToken() {

    const response = await doRequest(
        "POST",
        "id.twitch.tv",
        "/oauth2/token?grant_type=refresh_token&refresh_token=" + APP_REFRESH_TOKEN + "&client_id=" + APP_CLIENT_ID + "&client_secret=" + APP_CLIENT_SECRET,
        undefined,
        undefined
    );

    const json = JSON.parse(response);
    return json.access_token;

}

async function createTwitchClip( accessToken ) {

    try {

        const response = await doRequest(
            "POST",
            "api.twitch.tv",
            "/helix/clips?has_delay=false&broadcaster_id=" + CHANNEL_BROADCAST_ID,
            undefined,
            {
                "Authorization": "Bearer " + accessToken,
                "Client-ID": APP_CLIENT_ID,
            }
        );

        const json = JSON.parse(response);
        console.log("create-twitch-clip-json", json);

        const clipData = json.data[0];
        const clipID = clipData.id;
        const clipURL = "https://clips.twitch.tv/" + clipID;
        console.log("create-twitch-clip-clip-data=", clipData);
        console.log("create-twitch-clip-clip-id=", clipID);

        return {
            clipID,
            clipURL,
        };

    } catch( error ) {

        if( typeof error === "string" && error.indexOf("Clipping is not possible for an offline channel.") !== -1 ) {
            const newError = new Error("Someone tried to clip while the channel is offline :ugh:");
            newError.type = ERROR_TYPE_TWITCH_CHANNEL_OFFLINE;
            throw newError;
        }

        throw error;

    }

}

async function sendToDiscord( message ) {

    const postData = JSON.stringify({
        "content": message,
    });

    const path = "/api/webhooks/" + DISCORD_WEBHOOK_ID + "/" + DISCORD_WEBHOOK_TOKEN;

    await doRequest(
        "POST",
        "discordapp.com",
        path,
        postData,
        {
            "Content-Type": "application/json",
        }
    );

}

function doRequest( method, hostname, path, postData, headers ) {
    return new Promise(( resolve, reject ) => {

        const options = {
            method,
            hostname,
            path,
            port: 443,
            headers,
        };

        const request = https.request(options, ( response ) => {

            response.setEncoding("utf8");
            let returnData = "";

            response.on("data", ( chunk ) => {
                returnData += chunk;
            });

            response.on("end", () => {

                if( response.statusCode < 200 || response.statusCode >= 300 ) {
                    reject(returnData);
                } else {
                    resolve(returnData);
                }

            });

            response.on("error", ( error ) => {
                reject(error);
            });

        });

        if( postData ) {
            request.write(postData);
        }

        request.end();
    });

}

function wait( time ) {
    console.log("waiting");
    return new Promise(( resolve, reject ) => {
        setTimeout(() => {
            console.log("wait done");
            resolve();
        }, time);
    });
}

async function main( username ) {

    let accessToken;
    let responseClipURL;
    let messageDiscord;

    try {
        accessToken = await getRefreshedAccessToken();
    } catch( error ) {
        console.error("problem-fetching-access-token", error);
        return "Unexpected problem when fetching the access token.";
    }

    try {
        console.log("accesstoken", accessToken);

        const response = await createTwitchClip(accessToken);
        const clipID = response.clipID;
        responseClipURL = response.clipURL;

        await wait(DELAY_TO_POST_TO_DISCORD);

    } catch( error ) {

        console.error("problem-creating-clip", error);

        if( typeof error === "string" && error.indexOf("{") === 0 ) {

            error = JSON.parse(error);

            // Twitch broke =(
            if( error.error === "Service Unavailable" && error.status === 503 ) {
                return "Twitch API didn't want to create a clip right now, you need to manually create the clip :(";
            }

        }

        if( error.type === ERROR_TYPE_TWITCH_CHANNEL_OFFLINE ) {
            return "I can't clip while the channel is offline :(";
        }

        return "Unexpected problem when creating the clip.";
    }

    try {
        messageDiscord = POST_MESSAGE_DISCORD(username, responseClipURL);
        await sendToDiscord(messageDiscord);
    } catch( error ) {
        console.error("problem-sending-to-discord", error);
        return "Unexpected problem when posting to Discord.";
    }

    try {
        return POST_MESSAGE_TWITCH_CHAT();
    } catch( error ) {
        console.error("problem-getting-twitch-chat-response", error);
        return "Unexpected problem getting response to Twitch chat";
    }

}

// Defining API listening port
const port = 3000;

// Defining http server
const app = express();

app.get("/", async (req, res) => {
    const username = req.query.user;
    const message = await main(username);

    res.status(200);
    res.send({
        statusCode: 200,
        headers: {
            "content-type": "text/plain; charset=UTF-8"
        },
        body: message,
    });
});

// Starting express app
app.listen(port, () => console.log(`App listening on port ${port}!`));
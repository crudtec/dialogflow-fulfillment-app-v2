/**
 * Código feito pela CRUDTEC adaptado do site do DialogFlow.com
 * Acesse nosso site em www.crudtec.com.br
 * Responsáveis: Rafael Sotero @soterocra e Wladimir Teixeira @wladimirteixeira
 * Objetivo: Inserir eventos de uma clínica no Google Calendar utilizando o Fulfillment Inline do DialogFlow.
 */

'use strict';

const functions = require('firebase-functions');
const {
    google
} = require('googleapis');
const {
    WebhookClient
} = require('dialogflow-fulfillment');

// ## Insira o código do seu calendário criado.
const calendarId = ''; // Exemplo: 6ujc6j6rgfk02cp02vg6h38cs0@group.calendar.google.com

// ## Insira a sua chave de integração com o Google Calendar
const serviceAccount = {}; // Esse objeto JSON parece com: { "type": "service_account", ... }

const serviceAccountAuth = new google.auth.JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: 'https://www.googleapis.com/auth/calendar'
});

const calendar = google.calendar('v3');
process.env.DEBUG = 'dialogflow:*'; // Ativa as libs de degug.

const timeZone = 'America/Sao_Paulo'; // Coloque aqui seu timezone, referencia: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
const timeZoneOffset = '-03:00'; // Coloque aqui a diferença de horas com UTC da sua região, referência: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones

let specialistBusy = false;
let possibleRanges = {
    1: true,
    2: true,
    3: true
}
exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {
    const agent = new WebhookClient({
        request,
        response
    });

    function makeAppointment(agent) {                
        const appointmentDuration = 1; // Define que uma consulta possui 1 hora.
        const dateTimeStart = convertParametersDate(agent.parameters.date, agent.parameters.time);
        const dateTimeEnd = addHours(dateTimeStart, appointmentDuration);
        const appointmentTimeString = getLocaleTimeString(dateTimeStart);
        const appointmentDateString = getLocaleDateString(dateTimeStart);
        // Verifica a disponibilidade no calendário. Recebe como parâmetro a data que o usuário escolheu e a especialidade. Entidades do DialogFlow.
        return createCalendarEvent(dateTimeStart, dateTimeEnd, agent.parameters.especialidade).then(() => {
            agent.add(`Ok. Consulta marcada para ${appointmentDateString} as ${appointmentTimeString}. Veremos voce em breve, ate logo.`);
        }).catch(() => {            
            let possibles = "";

            if (possibleRanges['1'] === true) {
                possibles += getLocaleTimeString(addHours(dateTimeStart, 1)) + ', ';
            }

            if (possibleRanges['2'] === true) {
                possibles += getLocaleTimeString(addHours(dateTimeStart, 2)) + ', ';
            }

            if (possibleRanges['3'] === true) {
                possibles += getLocaleTimeString(addHours(dateTimeStart, 3)) + ', ';
            }
        
            if (possibles != '') {
                agent.add(`Olha, não temos disponibilidade para esse horário. Veja esse(s) outro(s) horário(s): ${possibles}e caso decida me chame novamente.`)
            } else {
                agent.add(`Infelizmente esse horário não está disponível, pode tentar novamente em outra data?`);
            }
        });
    }
    let intentMap = new Map();
    intentMap.set('SUA INTENCAO AQUI', makeAppointment); // Essa parte mapeia a intenção 'SUA INTENCAO AQUI' para a funcao 'makeAppointment()'. Substitua 'SUA INTENCAO AQUI' pela sua intenção do DialogFlow.
    agent.handleRequest(intentMap);
});

function createCalendarEvent(dateTimeStart, dateTimeEnd, especialidade) {
    return new Promise((resolve, reject) => {
        calendar.events.list({ // Lista todos os eventos em um período específico.
            auth: serviceAccountAuth,
            calendarId: calendarId,
            timeMin: dateTimeStart.toISOString(),
            timeMax: dateTimeEnd.toISOString()
        }, (err, calendarResponse) => {
            
            if (err) {
                console.log(err);
                reject(err);
            }
            
            // Se houver algo no período, verificar se é no horário que o usuário escolheu e se for verifica se a especialidade está ocupada.
            if (calendarResponse.data.items.length > 0) {            
                for (var i = 0; i < calendarResponse.data.items.length; i++) {
                    var item = calendarResponse.data.items[i];
                    var itemStartDateTime = new Date(item.start.dateTime);
                    var itemEndDateTime = new Date(item.end.dateTime);

                    var userStartDateTime = new Date(dateTimeStart);
                    var userEndDateTime = new Date(dateTimeEnd);

                    if (
                        (itemStartDateTime >= userStartDateTime && itemStartDateTime <= userEndDateTime) ||
                        (itemEndDateTime >= userStartDateTime && itemEndDateTime <= userEndDateTime)) {
                        if (item.summary.toLowerCase().indexOf(especialidade.toLowerCase()) >= 0) {
                            specialistBusy = true;
                        }
                    }
                }
            }

            
            // Se a especialidade estiver ocupada, então tenta procurar outros horários para sugerir ao usuário.
            if (specialistBusy) {
                for (var i = 1; i <= 3; i++) {
                    for (var j = 0; j < calendarResponse.data.items.length; j++) {
                        var item = calendarResponse.data.items[j];
                        var itemStartDateTime = new Date(item.start.dateTime);
                        var itemEndDateTime = new Date(item.end.dateTime);

                        var userStartDateTime = new Date(addHours(dateTimeStart, i));
                        var userEndDateTime = new Date(addHours(dateTimeEnd, i));

                        if (
                            (itemStartDateTime >= userStartDateTime && itemStartDateTime <= userEndDateTime) ||
                            (itemEndDateTime >= userStartDateTime && itemEndDateTime <= userEndDateTime)) {
                            if (item.summary.toLowerCase().indexOf(especialidade.toLowerCase()) >= 0) {
                                possibleRanges[i] = false;
                            }
                        }
                    }
                }
                reject(new Error('Especialidade oculpada.'));
            }

            
            // Se a especialidade não estiver ocupada realiza o agendamento imediatamente.
            if (!specialistBusy) {                
                calendar.events.insert({
                    auth: serviceAccountAuth,
                    calendarId: calendarId,
                    resource: {
                        summary: especialidade,
                        start: {
                            dateTime: dateTimeStart
                        },
                        end: {
                            dateTime: dateTimeEnd
                        }
                    }
                }, (err, event) => {
                    err ? reject(err) : resolve(event);
                });
            }
        });
    });
}

// Uma função helper para resolver 'date' e 'time' Dialogflow's e retornar uma parâmetro de datetime.
function convertParametersDate(date, time) {
    return new Date(Date.parse(date.split('T')[0] + 'T' + time.split('T')[1].split('-')[0] + timeZoneOffset));
}

// Uma função helper que adiciona um valor inteiro 'hoursToAdd' para a instancia de data 'dateObj' e retorna uma nova instancia de data.
function addHours(dateObj, hoursToAdd) {
    return new Date(new Date(dateObj).setHours(dateObj.getHours() + hoursToAdd));
}

// Uma funçào helper que converte uma instancia de data 'dateObj' em uma string que representa essa hora em portugues brasil.
function getLocaleTimeString(dateObj) {
    return dateObj.toLocaleTimeString('pt-BR', {
        hour: 'numeric',
        hour12: false,
        timeZone: timeZone
    });
}

// Uma funçào helper que converte uma instancia de data 'dateObj' em uma string que representa essa data em portugues brasil.
function getLocaleDateString(dateObj) {
    return dateObj.toLocaleDateString('pt-BR', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: timeZone
    });
}
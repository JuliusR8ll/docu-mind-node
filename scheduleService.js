import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { parse, format, isValid, parseISO } from 'date-fns';
import { fileURLToPath } from 'url';

// Helper to get __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCHEDULE_FILE = path.join(__dirname, '_restaurant_schedule.csv');

let scheduleData = null;

/**
 * Reads the restaurant_schedule.csv file and loads it into a more efficient
 * object format for quick lookups.
 * @returns {Promise<object>} A promise that resolves with the schedule object.
 */
export const loadSchedule = () => {
    return new Promise((resolve, reject) => {
        if (scheduleData) {
            return resolve(scheduleData);
        }

        if (!fs.existsSync(SCHEDULE_FILE)) {
            const errorMessage = 'FATAL ERROR: restaurant_schedule.csv not found.';
            console.error(errorMessage);
            return reject(new Error(errorMessage));
        }

        const schedule = {};
        fs.createReadStream(SCHEDULE_FILE)
            .pipe(csv())
            .on('data', (row) => {
                schedule[row.DayOfWeek] = {
                    OpenTime: row.OpenTime,
                    CloseTime: row.CloseTime,
                };
            })
            .on('end', () => {
                console.log('✅ Restaurant schedule loaded successfully.');
                scheduleData = schedule;
                resolve(scheduleData);
            })
            .on('error', (error) => {
                console.error('❌ Fatal Error: Could not load restaurant schedule.', error);
                reject(error);
            });
    });
};

const formatToAMPM = (timeString) => {
    if (!timeString || timeString.toLowerCase() === 'closed') return 'Closed';
    const date = parseISO(`2000-01-01T${timeString}:00`);
    if (!isValid(date)) return 'Invalid Time';
    return format(date, 'h:mm a');
};

/**
 * Validates a user-provided date against the restaurant's schedule.
 * @param {string} dateInput - e.g., "2024-07-29", "tomorrow"
 * @returns {object} An object with validation status, day of the week, and a message.
 */
export const validateDate = (dateInput) => {
    let targetDate;
    try {
        targetDate = new Date(dateInput);
        if (!isValid(targetDate)) throw new Error();
    } catch (e) {
        return {
            isValid: false,
            message: "Sorry, I didn't understand that date. Please try a format like YYYY-MM-DD or a day like 'tomorrow'."
        };
    }

    const dayOfWeek = format(targetDate, 'EEEE'); // e.g., "Tuesday"
    const daySchedule = scheduleData[dayOfWeek];

    if (!daySchedule || daySchedule.OpenTime.toLowerCase() === 'closed') {
        return {
            isValid: false,
            dayOfWeek: dayOfWeek,
            message: `My apologies, we are closed on ${dayOfWeek}s. Could you please choose a different date?`,
        };
    }

    return {
        isValid: true,
        dayOfWeek: dayOfWeek,
        message: `Great, we are open on ${dayOfWeek}s!`,
    };
};

/**
 * Validates a user-provided time against the hours for a specific day.
 * @param {string} timeInput - e.g., "7pm", "19:30"
 * @param {string} dayOfWeek - e.g., "Tuesday"
 * @returns {object} An object with validation status and a message.
 */
export const validateTime = (timeInput, dayOfWeek) => {
    if (!scheduleData || !scheduleData[dayOfWeek]) {
        return { isValid: false, message: `Could not find schedule for ${dayOfWeek}.` };
    }
    const daySchedule = scheduleData[dayOfWeek];

    let militaryTime;
    try {
        const parsedDate = new Date(`1/1/2000 ${timeInput}`);
        if (!isValid(parsedDate)) throw new Error('Invalid time format');
        militaryTime = format(parsedDate, 'HH:mm');
    } catch (e) {
        return {
            isValid: false,
            message: "I'm sorry, I didn't catch that time. Please use a format like '7:30 PM' or '19:30'."
        }
    }

    if (militaryTime >= daySchedule.OpenTime && militaryTime <= daySchedule.CloseTime) {
        return {
            isValid: true,
            formattedTime: militaryTime,
            message: 'Perfect, that time works for us.',
        };
    } else {
        const open = formatToAMPM(daySchedule.OpenTime);
        const close = formatToAMPM(daySchedule.CloseTime);
        return {
            isValid: false,
            message: `I'm sorry, but on ${dayOfWeek}s our hours are from ${open} to ${close}. Please choose a time within that range.`,
        };
    }
};
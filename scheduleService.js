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
// In scheduleService.js

// REPLACE the entire old loadSchedule function with this one

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
            // === THIS IS THE FIX: Trim headers and ensure they are what we expect ===
            .pipe(csv({
                mapHeaders: ({ header }) => header.trim() // Trims whitespace from headers
            }))
            .on('data', (row) => {
                // Defensive check to ensure the 'DayOfWeek' column exists
                if (row.DayOfWeek) {
                    schedule[row.DayOfWeek.toLowerCase()] = {
                        OpenTime: row.OpenTime,
                        CloseTime: row.CloseTime,
                    };
                } else {
                    console.warn("CSV row is missing 'DayOfWeek' column:", row);
                }
            })
            .on('end', () => {
                // Defensive check to ensure we actually loaded something
                if (Object.keys(schedule).length === 0) {
                    const errorMessage = "FATAL ERROR: Restaurant schedule loaded, but is empty. Check restaurant_schedule.csv format.";
                    console.error(errorMessage);
                    console.error("Expected headers: DayOfWeek,OpenTime,CloseTime");
                    return reject(new Error(errorMessage));
                }
                
                console.log('✅ Restaurant schedule loaded successfully.');
                console.log('Loaded schedule data:', schedule); // Added for debugging, you can remove later
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
// This is the CORRECTED code for scheduleService.js

export const validateDate = (dateInput) => {
    let targetDate;
    try {
        targetDate = new Date(dateInput);
        if (!isValid(targetDate)) throw new Error();
    } catch (e) {
        return {
            isValid: false,
            message: "Sorry, I didn't understand that date. Please try a format like YYYY-MM-DD."
        };
    }

    const dayOfWeek = format(targetDate, 'EEEE'); // This still produces "Tuesday"
    
    // --- THIS IS THE FIX ---
    // Convert the generated day name to lowercase before looking it up in our data.
    const daySchedule = scheduleData[dayOfWeek.toLowerCase()];

    // Now the lookup will be scheduleData['tuesday'], which will work correctly.
    if (!daySchedule || daySchedule.OpenTime.toLowerCase() === 'closed') {
        return {
            isValid: false,
            dayOfWeek: dayOfWeek,
            message: `My apologies, we are closed on ${dayOfWeek}s. Could you please choose a different date?`,
        };
    }

    return {
        isValid: true,
        dayOfWeek: dayOfWeek, // We can still return the nicely formatted "Tuesday" to the user
        message: `Great, we are open on ${dayOfWeek}s!`,
    };
};

/**
 * Validates a user-provided time against the hours for a specific day.
 * @param {string} timeInput - e.g., "7pm", "19:30"
 * @param {string} dayOfWeek - e.g., "Tuesday"
 * @returns {object} An object with validation status and a message.
 */
// In scheduleService.js

// REPLACE the entire old validateTime function with this one

export const validateTime = (timeInput, dayOfWeek) => {
    // --- Start of Robust Debugging ---
    console.log(`[Time Validation] Received request for day: "${dayOfWeek}" at time: "${timeInput}"`);

    // Check if the main schedule data exists at all
    if (!scheduleData || Object.keys(scheduleData).length === 0) {
        console.error("[Time Validation] CRITICAL ERROR: scheduleData object is empty or null.");
        return { isValid: false, message: 'Server error: Restaurant schedule is not loaded.' };
    }
    
    // Defensive check: ensure dayOfWeek is a non-empty string before using methods on it
    if (typeof dayOfWeek !== 'string' || !dayOfWeek) {
        console.error(`[Time Validation] ERROR: dayOfWeek is not a valid string. Received: ${dayOfWeek}`);
        return { isValid: false, message: 'A valid day of the week is required.' };
    }
    // --- End of Robust Debugging ---

    const lowerCaseDay = dayOfWeek.toLowerCase();
    const daySchedule = scheduleData[lowerCaseDay];

    // Log what we found (or didn't find)
    if (daySchedule) {
        console.log(`[Time Validation] Found schedule for key "${lowerCaseDay}":`, daySchedule);
    } else {
        console.error(`[Time Validation] FAILED to find schedule for key "${lowerCaseDay}"`);
        console.error(`[Time Validation] Available keys are: [${Object.keys(scheduleData).join(', ')}]`);
        return { isValid: false, message: `Could not find schedule for ${dayOfWeek}. Please check server logs.` };
    }

    // The rest of the validation logic
    let militaryTime;
    try {
        const parsedDate = new Date(`1/1/2000 ${timeInput}`);
        if (!isValid(parsedDate)) throw new Error('Invalid time format');
        militaryTime = format(parsedDate, 'HH:mm');
    } catch (e) {
        return {
            isValid: false,
            message: "I'm sorry, I didn't catch that time. Please use a format like '7:30 PM' or '19:30'."
        };
    }

    if (militaryTime >= daySchedule.OpenTime && militaryTime <= daySchedule.CloseTime) {
        console.log(`[Time Validation] SUCCESS: ${militaryTime} is within ${daySchedule.OpenTime}-${daySchedule.CloseTime}.`);
        return {
            isValid: true,
            formattedTime: militaryTime,
            message: 'Perfect, that time works for us.',
        };
    } else {
        const formatToAMPM = (time) => format(new Date(`1/1/2000 ${time}`), 'h:mm a');
        const open = formatToAMPM(daySchedule.OpenTime);
        const close = formatToAMPM(daySchedule.CloseTime);
        console.log(`[Time Validation] FAILED: ${militaryTime} is NOT within ${daySchedule.OpenTime}-${daySchedule.CloseTime}.`);
        return {
            isValid: false,
            message: `I'm sorry, but on ${dayOfWeek}s our hours are from ${open} to ${close}. Please choose a time within that range.`,
        };
    }
};
/** DITO E LAGAY YUNG THING*/
const express = require('express');
const cors = require('cors');
const db = require('./db'); // Database connection

const app = express();
app.use(cors()); // Allows frontend to talk to backend
app.use(express.json()); // Enables JSON parsing
app.use(express.static('public')); // Serves static files (HTML, script.js)

// Get Room List
app.get('/rooms', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM room");
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Database error" });
    }
});

// Get rooms by aptLocId
app.get("/getRooms/:aptLocId", (req, res) => {
    const aptLocId = req.params.aptLocId;
    const sql = "SELECT Room_ID FROM room WHERE Apt_Loc_ID = ? AND Room_Status_ID = 1";

    db.query(sql, [aptLocId], (err, results) => {
        if (err) {
            console.error("Error fetching rooms:", err);
            res.status(500).json({ error: "Database error" });
        } else {
            res.json(results);
        }
    });
});
// End of Get rooms by aptLocId




// Add Tenant Route
app.post('/add-person', async (req, res) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const { 
            firstName, 
            middleName, 
            lastName, 
            contact, 
            dob, 
            sex,
            street,
            barangay,
            city,
            region,
            roomId,
            apartmentLocation // Apartment Location from the active slide
        } = req.body;

        // Insert person information
        const [personResult] = await connection.query(
            'INSERT INTO person_information (Person_FName, Person_MName, Person_LName, Person_Contact, Person_DOB, Person_sex) VALUES (?, ?, ?, ?, ?, ?)',
            [firstName, middleName || null, lastName, contact, dob, sex]
        );
        const personId = personResult.insertId;

        // Insert City
        const [cityResult] = await connection.query(
            'INSERT INTO city (City_Name, Region_Name) VALUES (?, ?)',
            [city, region]
        );
        const cityId = cityResult.insertId;

        // Insert Barangay
        const [barangayResult] = await connection.query(
            'INSERT INTO barangay (Brgy_Name, City_ID) VALUES (?, ?)',
            [barangay, cityId]
        );
        const barangayId = barangayResult.insertId;

        // Insert Address
        const [addressResult] = await connection.query(
            'INSERT INTO address (Person_Street, Brgy_ID) VALUES (?, ?)',
            [street, barangayId]
        );
        const addressId = addressResult.insertId;

        // Link Person to Address
        await connection.query(
            'INSERT INTO person_address (Person_ID, Address_ID) VALUES (?, ?)',
            [personId, addressId]
        );

        // Insert Occupant
        const [occupantResult] = await connection.query(
            'INSERT INTO occupants (Person_ID) VALUES (?)',
            [personId]
        );
        const occupantId = occupantResult.insertId;

        // Check room capacity
        const [roomCheck] = await connection.query(
            'SELECT Number_of_Renters, Room_maxRenters FROM room WHERE Room_ID = ?',
            [roomId]
        );

        if (roomCheck[0].Number_of_Renters >= roomCheck[0].Room_maxRenters) {
            await connection.rollback();
            return res.status(400).json({ error: "Room is at maximum capacity" });
        }

        // Update room occupancy
        await connection.query(
            'UPDATE room SET Number_of_Renters = Number_of_Renters + 1 WHERE Room_ID = ?',
            [roomId]
        );
        
        let aptLocID;

        if (apartmentLocation.startsWith("Matina")) {
            aptLocID = 1;
        } else if (apartmentLocation.startsWith("Sesame")) {
            aptLocID = 2;
        } else if (apartmentLocation.startsWith("Nabua")) {
            aptLocID = 3;
        } else {
            await connection.rollback();
            return res.status(400).json({ error: "Invalid apartment location" });
        }
        
        // Insert Contract into `contract` table
        await connection.query(
            `INSERT INTO contract (Person_ID, Apt_Loc_ID, Date) VALUES (?, ?, CURDATE())`,
            [personId, aptLocID]
        );
        
        // Insert Contract Details
        await connection.query(
            `INSERT INTO contract_details 
            (Room_ID, Occupants_ID, MoveIn_date, MoveOut_date, Actual_Move_In_Date, Room_Price, Down_Payment) 
            VALUES (?, ?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 6 MONTH), CURDATE(), 
            (SELECT Room_Price FROM room WHERE Room_ID = ?), 0)`,
            [roomId, occupantId, roomId]
        );

        await connection.commit();
        res.json({ personId, message: "Tenant and contract added successfully!" });
    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ error: "Failed to add person and contract details" });
    } finally {
        connection.release();
    }
});

// Remove Tenant Route
app.delete('/remove-tenant/:personId', async (req, res) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const personId = req.params.personId;

        // Remove person information directly
        const [result] = await connection.query(
            'DELETE FROM person_information WHERE Person_ID = ?',
            [personId]
        );

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ error: "Tenant not found or cannot be deleted" });
        }

        await connection.commit();
        res.json({ message: "Tenant removed successfully" });

    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ error: "Failed to remove tenant" });
    } finally {
        connection.release();
    }
});

// Edit Tenant Route
app.put('/edit-tenant/:personId', async (req, res) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const personId = req.params.personId;
        const { contact, moveInDate, moveOutDate } = req.body;

        // Validate contact number (must be 11 digits)
        if (!/^\d{11}$/.test(contact)) {
            return res.status(400).json({ error: "Contact number must be exactly 11 digits." });
        }

        // Update Person_Information table
        const [personUpdate] = await connection.query(
            'UPDATE person_information SET Person_Contact = ? WHERE Person_ID = ?',
            [contact, personId]
        );

        // Retrieve the correct Contract_ID for this Person_ID
        const [contractResult] = await connection.query(
            'SELECT Contract_ID FROM contract WHERE Person_ID = ?',
            [personId]
        );

        if (contractResult.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: "Contract not found for this tenant." });
        }

        const contractId = contractResult[0].Contract_ID;

        // Update Contract_Details using the retrieved Contract_ID
        const [contractUpdate] = await connection.query(
            'UPDATE contract_details SET Actual_Move_In_date = ?, MoveOut_date = ? WHERE Contract_ID = ?',
            [moveInDate, moveOutDate, contractId]
        );

        if (personUpdate.affectedRows === 0 || contractUpdate.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ error: "No changes made or tenant not found." });
        }

        await connection.commit();
        res.json({ message: "Tenant updated successfully." });

    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ error: "Failed to update tenant." });
    } finally {
        connection.release();
    }
});


// 🔹 Start the Server
app.listen(3000, () => {
    console.log('Server running at http://localhost:3000');
});

import axios from "axios";

// Change this to wherever your ASP.NET SAP server is hosted
const SAP_SERVER = "";

export async function sapLogon(user, password) {
    try {
        const res = await axios.post(`${SAP_SERVER}/logon`, {
            user,
            password
        });

        return res.data; 
    } catch (err) {
        console.error("SAP logon error:", err.response?.data || err.message);
        throw new Error(err.response?.data?.detail || "SAP logon failed");
    }
}

export async function sapReadTable(tableName, fields, options = [], rowCount = 500, delimiter = ";") {
    try {
        const res = await axios.post(`${SAP_SERVER}/read-table`, {
            tableName,
            fields,
            options,
            rowCount,
            delimiter
        });

        return res.data;
    } catch (err) {
        console.error("SAP RFC_READ_TABLE error:", err.response?.data || err.message);
        throw new Error(err.response?.data?.detail || "SAP read-table failed");
    }
}

let lastQuery = '';

setInterval(async () => {
  const res = await fetch('/session-check');
  const data = await res.json();
  if (!data.loggedIn) {
    alert("Your session has expired. Please log in again.");
    window.location.href = '/';
  }
}, 60000 * 5 ); // check every 5 minutes

async function checkSession() {
  const res = await fetch('/session-check');
  const data = await res.json();
  return data.loggedIn;
}

        async function sqlDrumming() {
            const loggedIn = await checkSession();
            if (!loggedIn) {
              alert("Session expired. Please log in again.");
              window.location.href = '/';
              return;
            }
            document.getElementById('query').value = 'SELECT * FROM dbo.Batches';
            runQuery();
        }

        async function sqlDrummingSAP() {
            const loggedIn = await checkSession();
            if (!loggedIn) {
              alert("Session expired. Please log in again.");
              window.location.href = '/';
              return;
            }
            document.getElementById('query').value = "SELECT a.Drum, a.Material, a.SAP, a.Customer, a.Batch as Traceability, a.TotalLength, b.Coil FROM dbo.Batches a JOIN dbo.Coils b ON a.Drum = b.Batch WHERE SAP =''";
            //runQuery();
        }

        async function sqlDrummingDRUM() {
            const loggedIn = await checkSession();
            if (!loggedIn) {
              alert("Session expired. Please log in again.");
              window.location.href = '/';
              return;
            }
            document.getElementById('query').value = "SELECT a.Drum, a.Material, a.SAP, a.Customer, a.Batch as Traceability, a.TotalLength, b.Coil FROM dbo.Batches a JOIN dbo.Coils b ON a.Drum = b.Batch WHERE Drum =''";
            //runQuery();
        }        

        async function sqlEwald() {
            const loggedIn = await checkSession();
            if (!loggedIn) {
                alert("Session expired. Please log in again.");
                window.location.href = '/';
                return;
            }
            document.getElementById('query').value = 'SELECT * FROM dbo.Ewald';
            runQuery();
        }

        async function sqlFirewall() {
            const loggedIn = await checkSession();
            if (!loggedIn) {
                alert("Session expired. Please log in again.");
                window.location.href = '/';
                return;
            }
            document.getElementById('query').value = 'SELECT * FROM dbo.Firewall';
            runQuery();
        }

        async function sqlConvo() {
            const loggedIn = await checkSession();
            if (!loggedIn) {
                alert("Session expired. Please log in again.");
                window.location.href = '/';
                return;
            }
            document.getElementById('query').value = 'SELECT * FROM dbo.Convo';
            runQuery();
        }

        async function sqlMixing() {
            const loggedIn = await checkSession();
            if (!loggedIn) {
                alert("Session expired. Please log in again.");
                window.location.href = '/';
                return;
            }
            document.getElementById('query').value = 'SELECT * FROM dbo.Mixing';
            runQuery();
        }

        async function sapRfcReadTable() {
            const loggedIn = await checkSession();
            if (!loggedIn) {
                alert("Session expired. Please log in again.");
                window.location.href = '/';
                return;
            }
            const message = document.getElementById('message');
            message.style.color = '';
            message.textContent = 'Connecting to SAP...';


            try {
              const res = await fetch("", { //SAP ASP.NET server address since nodeJS cannot use COM .dll
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include", // important! sends session cookie
                body: JSON.stringify({ Function: "RFC_READ_TABLE" })
              });

              const data = await res.json();

              if (!data.success) {
                message.textContent = '❌ SAP RFC failed: ' + (data.error || "Unknown error");
                message.style.color = 'red';
                console.error("SAP RFC Error:", data);
              } else {
                message.textContent = '✅ SAP connection successful!';
                message.style.color = 'green';
                console.log("RFC Result:", data);

                // Get your output div
                const outputDiv = document.getElementById("output");

                // If data.result exists, format it nicely
                if (outputDiv) {
                // Make the JSON pretty and readable
                const prettyJson = JSON.stringify(data.result, null, 2);
                
                // Optional: syntax-highlight for readability
                outputDiv.innerHTML = `<pre style="
                    background:#f4f4f4;
                    padding:10px;
                    border-radius:8px;
                    white-space:pre-wrap;
                    word-break:break-word;
                    font-family:monospace;
                ">${prettyJson}</pre>`;
                } else {
                console.warn("Output div not found on page!");
                }
              }
            } catch (err) {
              message.textContent = '❌ Error: ' + err.message;
              message.style.color = 'red';
            }
        }

        async function sapTest() {
            const loggedIn = await checkSession();
            if (!loggedIn) {
                alert("Session expired. Please log in again.");
                window.location.href = '/';
                return;
            }
            const message = document.getElementById('message');
            message.style.color = '';
            message.textContent = 'Connecting to SAP...';

            try {
              const res = await fetch("", {  //SAP ASP.NET server address since nodeJS cannot use COM .dll
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include", // important! sends session cookie
                body: JSON.stringify({ FunctionModule: "STFC_CONNECTION" })
              });

              const data = await res.json();

              if (!data.success) {
                message.textContent = '❌ SAP RFC failed: ' + (data.error || "Unknown error");
                message.style.color = 'red';
                console.error("SAP RFC Error:", data);
              } else {
                message.textContent = '✅ SAP connection successful!';
                message.style.color = 'green';
                console.log("RFC Result:", data);
              }
            } catch (err) {
              message.textContent = '❌ Error: ' + err.message;
              message.style.color = 'red';
            }
        }

        async function sapNoCoTest() {
            const loggedIn = await checkSession();
            if (!loggedIn) {
                alert("Session expired. Please log in again.");
                window.location.href = '/';
                return;
            }
            const message = document.getElementById('message');
            message.style.color = '';
            message.textContent = 'Connecting to SAP...';

            try {
              const res = await fetch("", {  //SAP ASP.NET server address since nodeJS cannot use COM .dll
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include", // important! sends session cookie
                body: JSON.stringify({ FunctionModule: "STFC_CONNECTION" })
              });

              const data = await res.json();

              if (!data.success) {
                message.textContent = '❌ SAP RFC failed: ' + (data.error || "Unknown error");
                message.style.color = 'red';
                console.error("SAP RFC Error:", data);
              } else {
                message.textContent = '✅ SAP connection successful!';
                message.style.color = 'green';
                console.log("RFC Result:", data);
              }
            } catch (err) {
              message.textContent = '❌ Error: ' + err.message;
              message.style.color = 'red';
            }
        }

        async function runQuery() {
            const loggedIn = await checkSession();
            if (!loggedIn) {
                alert("Session expired. Please log in again.");
                window.location.href = '/';
                return;
            }
            const query = document.getElementById('query').value;
            lastQuery = query;
            const message = document.getElementById('message');
            const output = document.getElementById('output');

            message.style.color = '';
            message.textContent = 'Running query...';
            output.innerHTML = '';

            try {
              const res = await fetch('/query', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': '123' // match this to api key in config
                },
                body: JSON.stringify({ query })
              });

              const data = await res.json();

              if (!data.success) {
                message.textContent = '❌ ' + data.error;
                message.style.color = 'red';
                return;
              }

              let html = '';

              if (data.rowsAffected && data.rowsAffected.length > 0) {
                html += '<div>✅ Rows affected: ' + data.rowsAffected.join(', ') + '</div>';
              }

              if (data.recordset && data.recordset.length > 0) {

                const headers = Object.keys(data.recordset[0]);

                let html = '<table id="resultsTable"><thead>';
                html += '<tr>';
                headers.forEach(h => html += '<th>' + h + '</th>');
                html += '</tr></thead><tbody>';

                data.recordset.forEach(row => {
                  html += '<tr>';
                  headers.forEach(h => {
                    let value = row[h];
                    if (value === null || value === undefined) value = '';
                    value = String(value)
                      .replace(/&/g, "&amp;")
                      .replace(/</g, "&lt;")
                      .replace(/>/g, "&gt;")
                      .replace(/"/g, "&quot;");
                    html += "<td>" + value + "</td>";

                  });
                  html += '</tr>';
                });
                  html += '</tbody></table>';

                  output.innerHTML = html;
                  document.getElementById('output').innerHTML = html;
                  new DataTable('#resultsTable');

              } else if (!data.recordset || data.recordset.length === 0) {

                html += '<div>No rows returned.</div>';
                output.innerHTML = html;

              }
              message.textContent = '';

            } catch (err) {
              message.textContent = '❌ Error: ' + err.message;
            }
        }

        async function downloadCSV() {
            const loggedIn = await checkSession();
            if (!loggedIn) {
                alert("Session expired. Please log in again.");
                window.location.href = '/';
                return;
            }
            if (!lastQuery) {
              alert('Run a query first!');
              return;
            }
            const encoded = encodeURIComponent(lastQuery);
            const url = '../../query-csv?query=' + encoded + '&key=123'; //match this to api key in config
            window.open(url, '_blank');
        }

        async function downloadCSVPost() {
          const loggedIn = await checkSession();
          if (!loggedIn) {
              alert("Session expired. Please log in again.");
              window.location.href = '/';
              return;
          }
          if (!lastQuery) {
            alert('Run a query first!');
            return;
          }
          
          const form = document.createElement('form');
          form.method = 'POST';
          form.action = '/query-csv';
          
          const queryInput = document.createElement('input');
          queryInput.type = 'hidden';
          queryInput.name = 'query';
          queryInput.value = lastQuery;
          
          const keyInput = document.createElement('input');
          keyInput.type = 'hidden';
          keyInput.name = 'key';
          keyInput.value = '123';  //match this to api key in config
          
          form.appendChild(queryInput);
          form.appendChild(keyInput);
          document.body.appendChild(form);
          form.submit();
          document.body.removeChild(form);
        }

// --------------------------------------
// SAP: LOGON (calls ASP.NET backend)
// --------------------------------------
async function sapLogon() {
    if (!(checkSession())) return;

    const msg = document.getElementById("message");
    msg.textContent = "Connecting to SAP...";
    msg.style.color = "";

    try {
        const res = await fetch("/sap/logon", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                user: "youruser",
                password: "yourpass"
            })
        });

        const data = await res.json();
        if (!data.connected) {
            msg.textContent = "❌ SAP logon failed.";
            msg.style.color = "red";
        } else {
            msg.textContent = "✅ SAP logon successful!";
            msg.style.color = "green";
        }
        console.log("SAP Logon →", data);

    } catch (err) {
        msg.textContent = "❌ " + err.message;
        msg.style.color = "red";
    }
}


// ----------------------------------------------------
// SAP: READ TABLE (calls ASP.NET backend via queue)
// ----------------------------------------------------
async function sapReadTable() {
    if (!(checkSession())) return;

    const msg = document.getElementById("message");
    const output = document.getElementById("output");

    msg.textContent = "Reading table from SAP...";
    msg.style.color = "";
    output.innerHTML = "";

    try {
        const res = await fetch("/sap/read-table", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                tableName: "MARA",
                fields: ["MATNR", "MTART"],
                options: ["MTART = 'FERT'"],
                rowCount: 50,
                delimiter: ";"
            })
        });

        const data = await res.json();

        if (data.error || data.detail) {
            msg.textContent = "❌ SAP error: " + (data.error || data.detail);
            msg.style.color = "red";
            console.error("SAP READ ERROR:", data);
            return;
        }

        msg.textContent = "✅ SAP table retrieved";
        msg.style.color = "green";

        // Pretty-print output
        output.innerHTML = `
            <pre style="
                background:#f7f7f7;
                padding:10px;
                border-radius:8px;
                white-space:pre-wrap;
                font-family:monospace;
            ">${JSON.stringify(data, null, 2)}</pre>
        `;

        console.log("SAP READ RESULT →", data);

    } catch (err) {
        msg.textContent = "❌ " + err.message;
        msg.style.color = "red";
    }
}


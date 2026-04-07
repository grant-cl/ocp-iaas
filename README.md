# AWX Form - Basebuild OSV

A web form for launching AWX job templates for OpenShift Virtualization VM provisioning.

## Features

- **D3. **AWX job launch fails**: Verify AWX token and job template IDnamic Network Interface Selection**: Populates network interface dropdown with network attachment definitions from OpenShift API
- **Dynamic Namespace Selection**: Populates namespace dropdown with namespaces labeled "awx": "ocp-iaas"
- **Subnet Mask Selection**: User-friendly dropdown showing both decimal and CIDR notation
- **AWX Integration**: Directly launches AWX job template #7 with form data as extra vars

## Setup

### Prerequisites
- Node.js installed
- Access to OpenShift cluster API
- Access to AWX server

### Test Installation

1. Clone or download this project
2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure AWX token (choose one option):
   
   **Option A: Environment Variable**
   ```bash
   export AWX_TOKEN=your-awx-token
   ```
   
   **Option B: .env file**
   ```bash
   cp env.example .env
   # Edit .env file with your token
   ```

4. Start the server:
   ```bash
   npm start
   # or
   node server.js
   ```

5. Open your browser to: http://localhost:3000

## Configuration

### Authentication Configuration

# Authentication Configuration
# Use 'local' for development (admin/admin or test/test)
# Use 'ldapauth' for production LDAP authentication
AUTH_STRATEGY=ldapauth

# LDAP Configuration example
LDAP_URL=ldaps://ldap.example.com:636
LDAP_BIND_DN=cn=admin,ou=serviceaccounts,dc=test,dc=example
LDAP_BIND_PASSWORD=ldapbindpw
LDAP_SEARCH_BASE=ou=users,dc=test,dc=example
# ldap search filter (who can login)
LDAP_SEARCH_CUSTOM=(uid={{username}})


### AWX Configuration

AWX_HOSTNAME=awx.apps.ocp.example.com
AWX_TOKEN=your-awx-user-token
AWX_DAY1_TEMPLATE_ID=1
AWX_DAY2_TEMPLATE_ID=2


### Cluster Configuration
Set the `CLUSTER_CONFIG` environment variable with a JSON array of cluster objects:
```bash
export CLUSTER_CONFIG='[
  {
    "name": "ocp",
    "repo": "openshift-ocp",
    "satellite": "satellite.example.com",
    "ocp_hostname": "api.ocp.example.com",
    "ocp_token": "your-ocp-token-here-1",
    "netattachnamespace": "default"
  },
  {
    "name": "ocp2",
    "repo": "openshift-ocp2",
    "satellite": "satellite.example.com",
    "ocp_hostname": "api.ocp2.example.com",
    "ocp_token": "your-ocp-token-here-2",
    "netattachnamespace": "default"
  }
]'
```

Each cluster object should have:
- `name`: The cluster name
- `repo`: The cluster repository name
- `satellite`: The satellite server hostname
- `ocp_hostname`: The OpenShift API hostname
- `ocp_token`: The OpenShift API token
- `namespace` (optional): The namespace for network attachment definitions (defaults to "default")




## API Endpoints

- `GET /` - Serves the main form
- `GET /api/clusters` - Fetches available clusters from CLUSTER_CONFIG
- `GET /api/config` - Fetches config values like DNS servers from environment variables
- `GET /api/storageclasses?cluster=<name>` - Fetches storage classes from env override or from the selected cluster's OpenShift API
- `GET /api/network-attachment-definitions?cluster=<name>` - Fetches network attachment definitions from the specified cluster's OpenShift API
- `GET /api/namespaces?cluster=<name>` - Fetches namespaces with "awx": "ocp-iaas" label from the specified cluster
- `POST /awx/run-template` - Launches AWX job template with form data


## Troubleshooting

1. **"Cannot GET /api/..." errors**: Check that the server is running and endpoints are properly configured
2. **Network attachment definitions not loading**: Verify OpenShift API access and token validity
3. **Namespace dropdown empty**: Check that namespaces have the required "awx": "basebuild-osv" label
4. **AWX job launch fails**: Verify AWX credentials and job template ID

## File Structure

```
├── awx-form.html            # Web form interface
├── Containerfile            # Containerfile to build image
├── database.js           # better sqlite3
├── env.example             # Environment variables template
├── login.html            # login form
├── package.json             # Node.js dependencies
├── ocp-examples           # deployment and service account examples for openshift
├── server.js                 # Main server file
├── submissions.html         # form that shows submitted VMs
└── README.md                # This file
```

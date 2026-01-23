# How to Start the Backend Server

## Quick Start

1. **Open a terminal/command prompt**

2. **Navigate to the backend folder:**
   ```bash
   cd backend
   ```

3. **Start the backend:**
   ```bash
   npm run start:dev
   ```

4. **Wait for this message:**
   ```
   🚀 Backend server is running on: http://localhost:3001
   ```

5. **Test it works:**
   - Open browser: `http://localhost:3001/ping`
   - Should see: `{"ok":true,"message":"Server is running"}`

## Troubleshooting

### Backend won't start?

**Check 1: Database Connection**
- Make sure PostgreSQL is running
- Check your `DATABASE_URL` in `.env` file
- Format: `postgresql://user:password@localhost:5432/dbname`

**Check 2: Environment Variables**
Create `backend/.env` file with:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/dbname"
PORT=3001
NODE_ENV=development
```

**Check 3: Dependencies**
```bash
cd backend
npm install
```

**Check 4: Prisma Setup**
```bash
cd backend
npm run prisma:generate
```

**Check 5: Port Already in Use**
If port 3001 is already in use:
- Change `PORT` in `.env` to another port (e.g., `3002`)
- Update frontend `NEXT_PUBLIC_API_URL` to match

### Still having issues?

Check the terminal output when running `npm run start:dev` - it will show the exact error.


import express, { json } from 'express'
import { corsMiddleware } from './middlewares/cors.js'
import { docRouter } from './routes/api-docs.js'
import { createMoviesRouter } from './routes/movies.js'
import { MovieModel } from './models/mysql/movie.js'

const app = express()

app.disable('x-powered-by')

app.use(json())
app.use(corsMiddleware())
app.use('/api-docs', docRouter)
app.use('/movies', createMoviesRouter({ movieModel: MovieModel }))

app.post('/login', (req, res) => {
})

app.post('/register', (req, res) => {
})

app.post('/logout', (req, res) => {
})

app.get('/protected', (req, res) => {
})

const PORT = process.env.PORT ?? 3000

app.listen(PORT, () => {
  console.log(`Server started on ${PORT}`)
})

app.use((req, res) => {
  res.status(404).send('Not Found')
})

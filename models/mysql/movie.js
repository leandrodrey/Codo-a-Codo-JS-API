import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import { connectionString } from '../../db/db-connect.js';

export class MovieModel {

    static async getAll({ genre, sortOrder = 'asc' }) {
        let connection;
        try {
            connection = await mysql.createConnection(connectionString);

            let query = `
                SELECT m.*,
                    GROUP_CONCAT(DISTINCT a.name) AS actors,
                    GROUP_CONCAT(DISTINCT d.name) AS directors,
                        (
                        SELECT GROUP_CONCAT(DISTINCT g.name)
                        FROM movie_genre mg
                                JOIN genre g ON mg.genre_id = g.id
                        WHERE mg.movie_id = m.id
                       ) AS genres
                FROM movie m
                        LEFT JOIN movie_actor ma ON m.id = ma.movie_id
                        LEFT JOIN actor a ON ma.actor_id = a.id
                        LEFT JOIN movie_director md ON m.id = md.movie_id
                        LEFT JOIN director d ON md.director_id = d.id
                        JOIN movie_genre mgf ON m.id = mgf.movie_id  -- JOIN para filtrar por género
                        JOIN genre gf ON mgf.genre_id = gf.id
            `;

            const params = [];

            if (genre) {
                query += ' WHERE gf.name LIKE ?';
                params.push(`%${genre}%`);
            }

            query += ' GROUP BY m.id';

            if (sortOrder) {
                const validOrders = ['asc', 'desc'];
                if (!validOrders.includes(sortOrder.toLowerCase())) {
                    throw new Error('Invalid sort order. Use "asc" or "desc".');
                }
                query += ` ORDER BY m.year ${sortOrder.toUpperCase()}`;
            }

            const [rows] = await connection.execute(query, params);

            const formattedRows = rows.map((row) => ({
                ...row,
                id: row.id
                    .toString('hex')
                    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'),
            }));

            return formattedRows;
        } catch (error) {
            console.error('Error fetching movies:', error);
            throw error;
        } finally {
            if (connection) connection.end();
        }
    }

    static async getById({ id }) {
        let connection;
        try {
            connection = await mysql.createConnection(connectionString);

            const query = `
                SELECT 
                    m.*,
                    GROUP_CONCAT(DISTINCT a.name) AS actors,
                    GROUP_CONCAT(DISTINCT d.name) AS directors,
                    GROUP_CONCAT(DISTINCT g.name) AS genres
                FROM movie m
                LEFT JOIN movie_actor ma ON m.id = ma.movie_id
                LEFT JOIN actor a ON ma.actor_id = a.id
                LEFT JOIN movie_director md ON m.id = md.movie_id
                LEFT JOIN director d ON md.director_id = d.id
                LEFT JOIN movie_genre mg ON m.id = mg.movie_id
                LEFT JOIN genre g ON mg.genre_id = g.id
                WHERE m.id = UNHEX(REPLACE(?, "-", ""))
                GROUP BY m.id
            `;

            const [rows] = await connection.execute(query, [id])
            if (rows.length) {
                // Convertir el ID de Buffer a UUID
                const formattedRow = {
                    ...rows[0],
                    id: Buffer.from(rows[0].id).toString('hex').replace(
                        /(.{8})(.{4})(.{4})(.{4})(.{12})/,
                        '$1-$2-$3-$4-$5'
                    )
                }
                return formattedRow
            } else {
                return null
            }

        } catch (error) {
            console.error('Error al obtener la película por ID:', error)
            throw error
        } finally {
            if (connection) connection.end()
        }
    }

    static async create({ input }) {
        const connection = await mysql.createConnection(connectionString);

        try {
            await connection.beginTransaction();

            const movieId = Buffer.from(uuidv4().replace(/-/g, ''), 'hex');
            const sql = 'INSERT INTO movie (id, title, year, duration, poster, rate, trailer, status, budget, revenue, overview) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            const [result] = await connection.execute(sql,
                [
                    movieId,
                    input.title,
                    input.year,
                    input.duration,
                    input.poster,
                    input.rate,
                    input.trailer,
                    input.status,
                    input.budget,
                    input.revenue,
                    input.overview,
                ]
            );

            if (input.actors && input.actors.length > 0) {
                const actorIds = await this._getActorIds(connection, input.actors);
                const actorValues = actorIds.map((actorId) => [movieId, actorId]);
                await connection.query(
                    'INSERT INTO movie_actor (movie_id, actor_id) VALUES ?',
                    [actorValues]
                );
            }

            if (input.directors && input.directors.length > 0) {
                const directorIds = await this._getDirectorIds(connection, input.directors);
                const directorValues = directorIds.map((directorId) => [movieId, directorId]);
                await connection.query(
                    'INSERT INTO movie_director (movie_id, director_id) VALUES ?',
                    [directorValues]
                );
            }

            if (input.genres && input.genres.length > 0) {
                const genreIds = await this._getGenreIds(connection, input.genres);
                const genreValues = genreIds.map((genreId) => [movieId, genreId]);
                await connection.query(
                    'INSERT INTO movie_genre (movie_id, genre_id) VALUES ?',
                    [genreValues]
                );
            }

            await connection.commit();

            const createdMovie = await this.getById({ id: movieId.toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5') }); // Obtener la película por su ID formateado
            return createdMovie;
        } catch (error) {
            await connection.rollback();
            console.error("Error al crear la película:", error);
            throw error;
        } finally {
            connection.end();
        }
    }

    static async delete({ id }) {
        const connection = await mysql.createConnection(connectionString);

        try {
            const movieId = Buffer.from(id.replace(/-/g, ''), 'hex');

            await connection.beginTransaction();

            await connection.execute('DELETE FROM movie_actor WHERE movie_id = ?', [movieId]);
            await connection.execute('DELETE FROM movie_director WHERE movie_id = ?', [movieId]);
            await connection.execute('DELETE FROM movie_genre WHERE movie_id = ?', [movieId]);

            const [result] = await connection.execute('DELETE FROM movie WHERE id = ?', [movieId]);

            await connection.commit();

            return result.affectedRows > 0;
        } catch (error) {
            await connection.rollback();
            console.error('Error al eliminar la película:', error);
            throw error;
        } finally {
            connection.end();
        }
    }

    static async update({ id, input }) {
        const connection = await mysql.createConnection(connectionString);

        try {
            const movieId = Buffer.from(id.replace(/-/g, ''), 'hex');

            await connection.beginTransaction();

            const fieldsToUpdate = Object.keys(input)
                .filter(key => key !== 'actors' && key !== 'directors' && key !== 'genres')
                .map(key => `${key} = ?`)
                .join(', ');

            if (fieldsToUpdate) {
                const valuesToUpdate = Object.values(input)
                    .filter(value => value !== input.actors && value !== input.directors && value !== input.genres);
                valuesToUpdate.push(movieId); // Agregar el movieId al final

                await connection.execute(
                    `UPDATE movie SET ${fieldsToUpdate} WHERE id = ?`,
                    valuesToUpdate
                );
            }

            if (input.actors) {
                await connection.execute('DELETE FROM movie_actor WHERE movie_id = ?', [movieId]);
                if (input.actors.length > 0) {
                    const actorIds = await this._getActorIds(connection, input.actors);
                    const actorValues = actorIds.map((actorId) => [movieId, actorId]);
                    await connection.query('INSERT INTO movie_actor (movie_id, actor_id) VALUES ?', [actorValues]);
                }
            }

            if (input.directors) {
                await connection.execute('DELETE FROM movie_director WHERE movie_id = ?', [movieId]);
                if (input.directors.length > 0) {
                    const directorIds = await this._getDirectorIds(connection, input.directors);
                    const directorValues = directorIds.map((directorId) => [movieId, directorId]);
                    await connection.query('INSERT INTO movie_director (movie_id, director_id) VALUES ?', [directorValues]);
                }
            }

            if (input.genres) {
                await connection.execute('DELETE FROM movie_genre WHERE movie_id = ?', [movieId]);
                if (input.genres.length > 0) {
                    const genreIds = await this._getGenreIds(connection, input.genres);
                    const genreValues = genreIds.map((genreId) => [movieId, genreId]);
                    await connection.query('INSERT INTO movie_genre (movie_id, genre_id) VALUES ?', [genreValues]);
                }
            }

            await connection.commit();

            return true;
        } catch (error) {
            await connection.rollback();
            console.error('Error al actualizar la película:', error);
            throw error;
        } finally {
            connection.end();
        }
    }

    static async _getActorIds(connection, actorNames) {
        const actorIds = [];
        for (const actorName of actorNames) {
            const [rows] = await connection.query(
                'SELECT id FROM actor WHERE name = ?',
                [actorName]
            );
            if (rows.length) {
                actorIds.push(rows[0].id);
            } else {
                const [result] = await connection.query(
                    'INSERT INTO actor (name) VALUES (?)',
                    [actorName]
                );
                actorIds.push(result.insertId);
            }
        }
        return actorIds;
    }

    static async _getDirectorIds(connection, directorNames) {
        const directorIds = [];
        for (const directorName of directorNames) {
            const [rows] = await connection.query(
                'SELECT id FROM director WHERE name = ?',
                [directorName]
            );
            if (rows.length) {
                directorIds.push(rows[0].id);
            } else {
                const [result] = await connection.query(
                    'INSERT INTO director (name) VALUES (?)',
                    [directorName]
                );
                directorIds.push(result.insertId);
            }
        }
        return directorIds;
    }

    static async _getGenreIds(connection, genreNames) {
        const genreIds = [];
        for (const genreName of genreNames) {
            const [rows] = await connection.query(
                'SELECT id FROM genre WHERE name = ?',
                [genreName]
            );
            if (rows.length) {
                genreIds.push(rows[0].id);
            } else {
                const [result] = await connection.query(
                    'INSERT INTO genre (name) VALUES (?)',
                    [genreName]
                );
                genreIds.push(result.insertId);
            }
        }
        return genreIds;
    }
}

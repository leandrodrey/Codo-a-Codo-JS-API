import {MovieModel} from "../models/movie.js";
import {validateMovie, validatePartialMovie} from "../schemas/movies.js";

export class MoviesController {

    static async getAll(req, res) {
        const {genre} = req.query;
        const movies = await MovieModel.getAll({genre});
        res.json(movies);
    }

    static async getById(req, res) {
        const {id} = req.params;
        const movie = await MovieModel.getById(id);
        if (!movie) {
            return res.status(404).send('Movie not found');
        }
        res.json(movie);
    }

    static async create(req, res) {
        const result = validateMovie(req.body);
        if (result.error) {
            return res.status(400).json({error: JSON.parse(result.error.message)});
        }
        const newMovie = await MovieModel.create({input: result.data});
        res.status(201).json(newMovie);
    }

    static async delete(req, res) {
        const {id} = req.params;
        const result = await MovieModel.delete({id});
        if (!result) {
            return res.status(404).send('Movie not found');
        }
        res.send('Movie deleted');
    }

    static async update(req, res) {
        const {id} = req.params;
        const result = validatePartialMovie(req.body);
        if (result.error) {
            return res.status(400).json({error: JSON.parse(result.error.message)});
        }
        const updatedMovie = await MovieModel.update({id, input: result.data});
        if (!updatedMovie) {
            return res.status(404).send('Movie not found');
        }
        res.json(updatedMovie);
    }

}

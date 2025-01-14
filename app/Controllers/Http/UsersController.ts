// import bcrypt from "bcrypt";
import { HttpContextContract } from "@ioc:Adonis/Core/HttpContext";
import DetailsUser from "App/Models/DetailsUser";
import User from "App/Models/User";
import AuditTrail from "App/Utils/classes/AuditTrail";
import {
  // IDataToken,
  IDataUserPayload,
  IDetailsUser,
  IUserPayload,
} from "App/Utils/interfaces";
import CreateUserValidator from "App/Validators/CreateUserValidator";
import { IUser } from "../../Utils/interfaces/user";
import {
  base64encode,
  getPermitsAndRoles,
  // hasPermit,
  messageError,
  sum,
  validatePagination,
  validatePermit,
} from "App/Utils/functions";
import { getToken } from "App/Utils/functions/jwt";
import { changeStatus } from "./../../Utils/functions/index";
import UserRole from "./../../Models/UserRole";
import UserPermit from "./../../Models/UserPermit";
import { Permit } from "App/Utils/_types";
import { bcryptEncode } from "./../../Utils/functions/auth";
// import { getAddressById } from "./../../Services/location";
import Role from "./../../Models/Role";
import { IPaginationValidated } from "App/Utils/interfaces/pagination";
import { IResponseData } from "App/Utils/interfaces/index";

export default class UsersController {
  /**
   * getDataUser
   */
  public async getDataUser({ response, request }: HttpContextContract) {
    let responseData: IResponseData = {
      message: "Detalles del Usuario ",
      status: 200,
    };

    const { payloadToken } = getToken(request.headers());
    // let payloadToken: IDataToken = decodeJWT(token);

    const { id } = request.qs();

    let detailsUsers: DetailsUser[], detailsUser;

    // const permitsAnsRolesPetitioner = await getPermitsAndRoles(
    //   request,
    //   response,
    //   payloadToken.id
    // );

    // const boolHasPermit = hasPermit(
    //   permitsAnsRolesPetitioner.permits,
    //   "detalles_Usuarios"
    // );

    // if (!boolHasPermit) {
    //   responseData["message"] =
    //     "No posee el permiso para ver el detalle del usuario.";
    //   responseData["error"] = true;
    //   return response.status(400).json(responseData);
    // }

    const { roles, permits } = await getPermitsAndRoles(request, response, id);

    const userId = id ? id : payloadToken["id"];

    try {
      detailsUsers = await DetailsUser.query()
        .from("details_users as du")
        .innerJoin("status as s", "du.status", "s.id")
        .select(["du.id as du_id", "*"])
        .where("user_id", userId);
    } catch (error) {
      console.error(error);
      responseData["message"] =
        "Error inesperado al obtener el detalle del usuario.\nRevisar Terminal.";
      responseData["error"] = true;
      return response.status(500).json(responseData);
    }

    // const location = await getAddressById(
    //   Number(detailsUsers[0]["$attributes"]["location"]),
    //   headerAuthorization
    // );

    detailsUser = {
      ...detailsUsers[0]["$attributes"],
      id: detailsUsers[0]["$extras"]["du_id"],
      status: detailsUsers[0]["$extras"]["status_name"],
      // location: { ...location },
    };

    delete detailsUser["user_id"];

    responseData[
      "message"
    ] += `${detailsUser["names"]["firstName"]} ${detailsUser["surnames"]["firstSurname"]}`;
    responseData["results"] = { detailsUser, roles, permits };

    return response.status(200).json(responseData);
  }

  private async getRoleId(role: string): Promise<number> {
    const usersRole = await Role.query()
      .select(["id"])
      .where("role_name", role);

    return Number(usersRole[0]["$attributes"]["id"]);
  }

  /**
   * showAll
   */
  public async showAll({ response, request }: HttpContextContract) {
    let responseData: IResponseData = {
      message: "Lista de Usuarios completa. | Sin paginación.",
      status: 200,
    };
    const { page, pageSize, role, key, value, first, only } = request.qs();

    let pagination: IPaginationValidated = { page: 0, pageSize: 1000000 };
    if (request.qs().with && request.qs().with === "pagination") {
      pagination = validatePagination(key, value, page, pageSize);
      responseData["message"] = "Lista de Usuarios completa. | Con paginación.";
    }

    let results: any[] = [],
      data: any[] = [];

    let count: number =
      pagination["page"] > 0
        ? pagination["page"] * pagination["pageSize"] - pagination["pageSize"]
        : 0;

    try {
      results = await DetailsUser.query()
        .preload("status_info")
        .select(["user_id as u_id", "*"])
        .orderBy("id", "desc")
        .limit(pagination["pageSize"])
        .offset(count);

      if (only) {
        const num = only === "active" ? 1 : 0;
        results = await DetailsUser.query()
          .preload("status_info")
          .select(["user_id as u_id", "*"])
          .where("status", num)
          .orderBy("id", "desc")
          .limit(pagination["pageSize"])
          .offset(count);
      }
    } catch (error) {
      return messageError(
        error,
        response,
        "Error inesperado al obtener todos los usuarios.",
        400
      );
    }

    // Filtro por Rol
    if (role) {
      try {
        const roleId: number =
          typeof role === "string" ? await this.getRoleId(role) : Number(role);
        let users: UserRole[] = await UserRole.query()
          .select(["user_id"])
          .where("role_id", roleId)
          .where("status", 1)
          .limit(pagination["pageSize"])
          .offset(count);

        results = [];
        await Promise.all(
          users.map(async (user) => {
            let tmpDetailsUser = await DetailsUser.query()
              .preload("status_info")
              .where("user_id", user["$attributes"]["user_id"])
              .orderBy("id", "desc")
              .limit(pagination["pageSize"])
              .offset(count);

            if (only) {
              const num = only === "active" ? 1 : 0;
              tmpDetailsUser = await DetailsUser.query()
                .preload("status_info")
                .select(["user_id as u_id", "*"])
                .where("status", num)
                .orderBy("id", "desc")
                .limit(pagination["pageSize"])
                .offset(count);
            }

            if (tmpDetailsUser.length > 0) results.push(tmpDetailsUser[0]);
          })
        );

        responseData["results"] = results;
      } catch (error) {
        return messageError(error, response);
      }
    }

    // results = results === null ? [] : results;
    try {
      results.map((user) => {
        let tmpNewData: any = {
          ...user["$attributes"],
          status: user["$preloaded"]["status_info"]["$extras"]["status_name"],
        };

        data.push(tmpNewData);
      });

      // Total Results
      try {
        responseData["total_results"] = (await DetailsUser.all()).length;
      } catch (error) {
        return messageError(
          error,
          response,
          "Error al obtener la cantidad de usuarios completa.",
          400
        );
      }
      // responseData["total_results"] = detailsUser.length;

      // Count
      count = results.length;

      // Next Page
      responseData["next_page"] =
        pagination["page"] * pagination["pageSize"] <
          responseData["total_results"] && pagination["page"] !== 0
          ? sum(parseInt(pagination["page"] + ""), 1)
          : null;

      // Previous Page
      responseData["previous_page"] =
        pagination["page"] - 1 > 0 && pagination["page"] !== 0
          ? pagination["page"] - 1
          : null;

      // Order by descending
      data = data.sort((a, b) => b.id - a.id);

      if (responseData["next_page"] === null && first === "up") {
        const lastElement = data.pop();
        responseData["results"] = [lastElement, ...data];
      }

      // responseData["message"] = "Lista de Usuarios";
      responseData["results"] = data;
      responseData["page"] = pagination["page"];
      responseData["count"] = count;

      return response.status(responseData["status"]).json(responseData);
    } catch (error) {
      console.error(error);
      return response.status(500).json({ message: "Request to Users failed!" });
    }
  }

  public async getRolesAndPermits({ response, request }: HttpContextContract) {
    const { id } = request.qs();

    const { roles, permits } = await getPermitsAndRoles(request, response, id);

    response
      .status(200)
      .json({ message: "Roles y Permisos", results: { roles, permits } });
  }

  // POST
  /**
   * createUser
   */
  private async createUser(
    reqDataUser: IDataUserPayload,
    token: string | undefined
  ) {
    let tmpToken: string = "";
    if (token) tmpToken = token;
    const auditTrail = new AuditTrail(tmpToken);
    await auditTrail.init();

    let passwordHashed;

    if (typeof reqDataUser["password"] === "string")
      passwordHashed = await bcryptEncode(reqDataUser["password"]);

    let newUser: IUser = {
      ...reqDataUser,
      id_number: await base64encode(String(reqDataUser["id_number"])),
      password: passwordHashed,
      status: 1,
      audit_trail: auditTrail.getAsJson(),
    };

    try {
      const user = await User.create(newUser);
      return { user, auditTrail };
    } catch (error) {
      return Promise.reject({ type: "user_key_duplicated" });
    }
  }

  private async createDetailsUser(
    id: number,
    reqDetailsUser: any,
    auditTrail: AuditTrail
  ) {
    let tmpDetailsUser: IDetailsUser = {
      society_type: reqDetailsUser.society_type,
      entity_type: reqDetailsUser.entity_type,
      politics: false,
      notification: false,

      dependency: reqDetailsUser.dependency,
      subdependency: reqDetailsUser.subdependency,

      id_type: reqDetailsUser.id_type.trim(),
      id_number: reqDetailsUser.id_number,

      names: reqDetailsUser.names,
      surnames: reqDetailsUser.surnames,
      email: reqDetailsUser.email,
      location: reqDetailsUser.location,
      cellphone_number: reqDetailsUser.cellphone_number,
      phone_number: reqDetailsUser.phone_number,
      gender: reqDetailsUser.gender,

      user_id: id,
      status: 1,
      audit_trail: auditTrail.getAsJson(),
    };

    try {
      const detailsUser = await DetailsUser.create({
        ...tmpDetailsUser,
      });
      return detailsUser;
    } catch (error) {
      console.error(error);
      return Promise.reject(
        "A ocurrido un error inesperado al crear los detalles del Usuario."
      );
    }
  }

  /**
   * create
   */
  public async create({ response, request }: HttpContextContract) {
    const { token } = getToken(request.headers());

    const { permits } = await getPermitsAndRoles(request, response);
    let flag: boolean = false;

    permits?.map((permit) => {
      if (permit.name === "crear_Usuarios") flag = true;
    });

    if (!flag)
      return response
        .status(403)
        .json({ message: "No posee los permisos para crear un Usuario." });

    const payload: IUserPayload = await request.validate(CreateUserValidator);

    try {
      const { user, auditTrail } = await this.createUser(
        payload["user"],
        token
      );

      const detailsUser = await this.createDetailsUser(
        user.id,
        { ...payload["detailsUser"], id_number: payload["user"]["id_number"] },
        auditTrail
      );
      return response.status(200).json({
        message: "Usuario creado correctamente.",
        results: { user, detailsUser },
      });
    } catch (error) {
      return messageError(error, response);
    }
  }

  /**
   * update
   */
  public async update({ response, request }: HttpContextContract) {
    const newData = request.body();
    const { id } = request.qs();
    const { token } = getToken(request.headers());

    try {
      if (typeof id === "string") {
        const detailsUser = await DetailsUser.findOrFail(id);
        let dataUpdated: any = {
          ...newData.detailsUser,
        };

        const auditTrail = new AuditTrail(token, detailsUser.audit_trail);
        auditTrail.update({ ...dataUpdated }, detailsUser);
        dataUpdated["audit_trail"] = auditTrail.getAsJson();

        // Updating data
        try {
          await detailsUser.merge({
            ...dataUpdated,
          });

          await detailsUser.save();
        } catch (error) {
          console.error(error);
          return response
            .status(500)
            .json({ message: "Error al actualizar: Servidor", error });
        }

        if (newData.user.password) {
          const user = await User.findByOrFail(
            "id_number",
            detailsUser.id_number
          );

          // Updating data
          try {
            await user.merge({
              password: await bcryptEncode(newData.user.password),
              audit_trail: auditTrail.getAsJson(),
            });
            await user.save();
          } catch (error) {
            console.error(error);
            return response
              .status(500)
              .json({ message: "Error al actualizar: Servidor", error });
          }
        }
        return response.status(200).json({
          message: `Usuario ${detailsUser.names.firstName} actualizado satisfactoriamente`,
          results: detailsUser,
        });
      }
    } catch (error) {
      console.error(error);
      return response
        .status(500)
        .json({ message: "Error interno: Servidor", error });
    }
  }

  /**
   * updatePassword
   */
  public async updatePassword({ response, request }: HttpContextContract) {
    const { token, payloadToken } = getToken(request.headers());

    const hasPermit = await validatePermit(
      response,
      request,
      token,
      Permit.UPDATE_USER
    );

    if (!hasPermit) {
      return messageError(
        undefined,
        response,
        `No posee el permiso (${Permit.UPDATE_USER}) para ver el detalle del usuario.`
      );
    }

    let responseData: IResponseData = {
      message: "Contraseña actualizada.",
      status: 200,
    };

    const newPassword = request.body()["password"];
    const { id } = request.qs();
    let _id = 0;
    if (!id) _id = payloadToken["id"];
    else _id = id;

    try {
      const user: User = await User.findOrFail(_id);
      const newUser = await user
        .merge({ password: await bcryptEncode(newPassword) })
        .save();
      responseData["results"] = newUser["$attributes"];
    } catch (error) {
      console.error(error);
      responseData["message"] =
        "Error inesperado al obtener la información del usuario.";
      responseData["status"] = 500;
    }

    return response.status(responseData["status"]).json(responseData);
  }

  /**
   * inactivate
   */
  public async inactivate({ request, response }: HttpContextContract) {
    const { token } = getToken(request.headers());
    const { id } = request.qs();
    // let user: User, detailsUser: DetailsUser;

    try {
      await User.findOrFail(id);
      await DetailsUser.findOrFail(id);
    } catch (error) {
      return response.status(400).json({
        message: `El id [${id}] de usuario no existe, verificar si se encuentra creado.`,
      });
    }

    const { success, results } = await changeStatus(
      User,
      id,
      "inactivate",
      token
    );

    if (success) {
      const { success, results } = await changeStatus(
        DetailsUser,
        id,
        "inactivate",
        token
      );

      if (success) {
        try {
          const userRoles = await UserRole.query().where("user_id", id);
          userRoles.map(async (ur) => {
            await ur.delete();
          });

          const userPermits = await UserPermit.query().where("user_id", id);
          userPermits.map(async (up) => {
            await up.delete();
          });

          return await response
            .status(200)
            .json({ message: "Usuario inactivado y datos asociados." });
        } catch (error) {
          console.error(error);

          return response.status(500).json({
            message: `Error al eliminar las relaciones de roles y permisos`,
          });
        }
      } else {
        console.error(results);
        return response
          .status(400)
          .json({ message: `Error al inactivar los datos del usuario` });
      }
    } else {
      console.error(results);
      return response
        .status(400)
        .json({ message: `Error al inactivar el usuario` });
    }
  }

  /**
   * destroy
   */
  public async destroy({}: HttpContextContract) {}
}
